const request = require("supertest");

// See auth.flow.test.js for why this mock exists — Redis-backed rate
// limiting needs a real Redis instance, out of scope for these tests.
jest.mock("../../src/middleware/rateLimitMiddleware", () => ({
  globalLimiter: (req, res, next) => next(),
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  passwordResetLimiter: (req, res, next) => next(),
  resendVerificationLimiter: (req, res, next) => next(),
  webhookLimiter: (req, res, next) => next(),
}));

const { app } = require("../../src/server");
const ApiLog = require("../../src/models/ApiLog");
const User = require("../../src/models/User");
const { sanitizeUrl, UNLOGGED_PATHS } = require("../../src/middleware/apiMonitorMiddleware");

// apiMonitor writes on res.on("finish") via a fire-and-forget
// ApiLog.create(...).catch(...), so the write can land a tick after
// supertest's request() promise resolves. A single setImmediate is
// enough to let that microtask/IO queue flush against an in-memory Mongo.
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("apiMonitor middleware — request logging", () => {
  it("creates one ApiLog entry for an ordinary /api/* request", async () => {
    const before = await ApiLog.countDocuments({});
    const res = await request(app).get("/api/pets");
    expect(res.status).toBe(200);
    await flush();
    const after = await ApiLog.countDocuments({});
    expect(after).toBe(before + 1);
  });

  it("records method, status code, and a numeric duration", async () => {
    await request(app).get("/api/pets");
    await flush();
    const entry = await ApiLog.findOne({ path: "/api/pets" }).sort({ createdAt: -1 });
    expect(entry).not.toBeNull();
    expect(entry.method).toBe("GET");
    expect(entry.statusCode).toBe(200);
    expect(typeof entry.durationMs).toBe("number");
  });

  it("does NOT log /api/system/health (regression: noisy keepalive/diagnostic logging)", async () => {
    const before = await ApiLog.countDocuments({});
    const res = await request(app).get("/api/system/health");
    expect(res.status).toBe(200);
    await flush();
    expect(await ApiLog.countDocuments({})).toBe(before);
  });

  it("does NOT log /api/system/version", async () => {
    const before = await ApiLog.countDocuments({});
    const res = await request(app).get("/api/system/version");
    expect(res.status).toBe(200);
    await flush();
    expect(await ApiLog.countDocuments({})).toBe(before);
  });

  it("still lets /api/system/health and /api/system/version work normally — excluding them from logging didn't break the routes", async () => {
    const health = await request(app).get("/api/system/health");
    expect(health.body.success).toBe(true);
    expect(health.body.status).toBe("ok");

    const version = await request(app).get("/api/system/version");
    expect(version.body.success).toBe(true);
    expect(typeof version.body.version).toBe("string");
  });

  it("the top-level GET /health check (outside /api/) still works and was never logged either way", async () => {
    const before = await ApiLog.countDocuments({});
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    await flush();
    expect(await ApiLog.countDocuments({})).toBe(before);
  });

  it("UNLOGGED_PATHS contains exactly the two diagnostic endpoints, nothing broader", () => {
    expect(UNLOGGED_PATHS.has("/api/system/health")).toBe(true);
    expect(UNLOGGED_PATHS.has("/api/system/version")).toBe(true);
    expect(UNLOGGED_PATHS.has("/api/pets")).toBe(false);
    expect(UNLOGGED_PATHS.has("/api/system")).toBe(false);
  });
});

describe("apiMonitor middleware — sensitive data handling", () => {
  it("does not store an Authorization header, request body, or cookies anywhere on the ApiLog document (schema-level check)", async () => {
    await request(app)
      .post("/api/auth/login")
      .set("Authorization", "Bearer some-unrelated-token")
      .set("Cookie", "session=should-not-be-stored")
      .send({ email: "nobody@example.com", password: "whatever-secret-value" });
    await flush();

    const entry = await ApiLog.findOne({ path: "/api/auth/login" }).sort({ createdAt: -1 });
    expect(entry).not.toBeNull();
    const stored = JSON.stringify(entry.toObject());
    expect(stored).not.toMatch(/whatever-secret-value/);
    expect(stored).not.toMatch(/should-not-be-stored/);
    expect(stored).not.toMatch(/some-unrelated-token/);
    // Confirms by construction, not just by absence: the schema simply
    // has no field capable of holding these in the first place.
    expect(Object.keys(ApiLog.schema.paths).sort()).toEqual(
      ["__v", "_id", "createdAt", "durationMs", "ipAddress", "method", "path", "statusCode", "userId"].sort()
    );
  });

  it("redacts a sensitive-looking query parameter if one is ever present (defensive — no current route sends secrets this way)", () => {
    expect(sanitizeUrl("/api/pets?token=abc123&species=Dog")).toBe("/api/pets?token=%5Bredacted%5D&species=Dog");
    expect(sanitizeUrl("/api/pets?Authorization=Bearer+xyz")).toBe("/api/pets?Authorization=%5Bredacted%5D");
  });

  it("leaves an ordinary query string untouched", () => {
    expect(sanitizeUrl("/api/pets?species=Dog&page=2")).toBe("/api/pets?species=Dog&page=2");
    expect(sanitizeUrl("/api/pets")).toBe("/api/pets");
  });

  it("redaction applies end-to-end through the real middleware, not just in the unit-tested helper", async () => {
    await request(app).get("/api/pets?token=leak-me-please&species=Dog");
    await flush();
    const entry = await ApiLog.findOne({ path: { $regex: "^/api/pets\\?" } }).sort({ createdAt: -1 });
    expect(entry).not.toBeNull();
    expect(entry.path).not.toMatch(/leak-me-please/);
    expect(entry.path).toContain("species=Dog");
  });
});

describe("ApiLog retention (TTL index)", () => {
  it("has a TTL index on createdAt with the documented 30-day retention window", async () => {
    await ApiLog.init(); // waits for Mongoose's automatic index build to finish
    const indexes = await ApiLog.collection.indexes();
    const ttlIndex = indexes.find((idx) => idx.key && idx.key.createdAt === 1);

    expect(ttlIndex).toBeDefined();
    expect(ttlIndex.expireAfterSeconds).toBe(30 * 24 * 60 * 60);
  });

  it("does not double up on createdAt indexes (the old plain `index: true` was removed, not left alongside the TTL one)", async () => {
    await ApiLog.init();
    const indexes = await ApiLog.collection.indexes();
    const createdAtIndexes = indexes.filter((idx) => idx.key && Object.prototype.hasOwnProperty.call(idx.key, "createdAt"));
    expect(createdAtIndexes.length).toBe(1);
  });
});

describe("GET /api/monitoring/api/summary — regression check (still works after the ApiLog changes)", () => {
  async function registerAndLogin(email, role) {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ displayName: "Test " + role, email, password: "password123" });
    await User.findOneAndUpdate({ email }, { role });
    const loginRes = await request(app).post("/api/auth/login").send({ email, password: "password123" });
    return { token: loginRes.body.data.accessToken };
  }

  it("still returns request-volume stats for an admin after logging changes", async () => {
    const admin = await registerAndLogin("apilog-summary-admin@example.com", "admin");
    await request(app).get("/api/pets");
    await flush();

    const res = await request(app).get("/api/monitoring/api/summary").set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.windowHours).toBe(24);
    expect(res.body.data.totalRequests).toBeGreaterThan(0);
  });
});
