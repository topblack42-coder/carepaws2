const request = require("supertest");

// See auth.flow.test.js for why this mock exists — Redis-backed rate
// limiting needs a real Redis instance, out of scope for these tests.
jest.mock("../../src/middleware/rateLimitMiddleware", () => ({
  globalLimiter: (req, res, next) => next(),
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  passwordResetLimiter: (req, res, next) => next(),
  resendVerificationLimiter: (req, res, next) => next(),
  resetLinkLimiter: (req, res, next) => next(),
  webhookLimiter: (req, res, next) => next(),
}));

const { app } = require("../../src/server");
const User = require("../../src/models/User");
const archiveRoutes = require("../../src/routes/archiveRoutes");

async function registerAndLogin(email, role = "user") {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ displayName: "Test " + role, email, password: "password123" });

  if (role !== "user") {
    await User.findOneAndUpdate({ email }, { role });
    // Log in again to get a token carrying the updated role.
    const loginRes = await request(app).post("/api/auth/login").send({ email, password: "password123" });
    return { token: loginRes.body.data.accessToken, user: loginRes.body.data.user };
  }

  return { token: res.body.data.accessToken, user: res.body.data.user };
}

describe("Generic archive API is unreachable on the real app (primary fix)", () => {
  it("POST /api/archive/:collection returns 404 — the router is not mounted", async () => {
    const res = await request(app).post("/api/archive/User").send({ id: "507f1f77bcf86cd799439011" });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/archive (list) returns 404", async () => {
    const res = await request(app).get("/api/archive");
    expect(res.status).toBe(404);
  });

  it("POST /api/archive/:id/restore returns 404", async () => {
    const res = await request(app).post("/api/archive/507f1f77bcf86cd799439011/restore");
    expect(res.status).toBe(404);
  });

  it("regression: an admin can no longer delete a real User document through this path — the actual, previously-exploitable outcome", async () => {
    const admin = await registerAndLogin("archive-victim-admin@example.com", "super_admin");
    const victim = await registerAndLogin("archive-victim-target@example.com", "user");

    const res = await request(app)
      .post("/api/archive/User")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ id: victim.user.id });
    expect(res.status).toBe(404); // route no longer exists at all

    const stillThere = await User.findById(victim.user.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere.isDeleted).not.toBe(true);
  });
});

// The router itself is also exercised directly here (mounted in a
// throwaway app, bypassing server.js entirely) to prove the *underlying*
// allowlist logic is sound on its own — this is what would protect the
// app if this router were ever accidentally re-registered, and it's the
// only way to exercise the auth/validation/allowlist behavior now that
// it isn't reachable through the real app.
describe("Archive router allowlist, exercised directly (isolated from server.js)", () => {
  let isolatedApp;

  beforeAll(() => {
    const express = require("express");
    const { notFoundHandler, errorHandler } = require("../../src/middleware/errorHandler");
    isolatedApp = express();
    isolatedApp.use(express.json());
    isolatedApp.use("/api/archive", archiveRoutes);
    isolatedApp.use(notFoundHandler);
    isolatedApp.use(errorHandler);
  });

  afterEach(() => {
    // In case the "happy path" test below fails before its own cleanup
    // runs, never let a test-only entry leak into another test.
    archiveRoutes.ARCHIVABLE_COLLECTIONS.delete("User");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(isolatedApp).post("/api/archive/User").send({ id: "507f1f77bcf86cd799439011" });
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin (role: user) with 403", async () => {
    const citizen = await registerAndLogin("archive-router-citizen@example.com", "user");
    const res = await request(isolatedApp)
      .post("/api/archive/User")
      .set("Authorization", `Bearer ${citizen.token}`)
      .send({ id: citizen.user.id });
    expect(res.status).toBe(403);
  });

  it("rejects an unsupported/unknown collection for an authenticated admin — 400, not a 500 from an undefined model", async () => {
    const admin = await registerAndLogin("archive-router-admin-unsupported@example.com", "super_admin");
    const res = await request(isolatedApp)
      .post("/api/archive/NotARealModel")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ id: "507f1f77bcf86cd799439011" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unsupported collection/i);
  });

  it("regression: rejects a real, sensitive model (User) even for an authenticated super_admin — this used to succeed", async () => {
    const admin = await registerAndLogin("archive-router-admin-protected@example.com", "super_admin");
    const victim = await registerAndLogin("archive-router-protected-victim@example.com", "user");

    const res = await request(isolatedApp)
      .post("/api/archive/User")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ id: victim.user.id });

    expect(res.status).toBe(400);
    expect(await User.findById(victim.user.id)).not.toBeNull();
  });

  it("rejects other sensitive models by name too (Payment, ApiKey, TokenBlacklist, Role, AuditLog) — not a User-only fix", async () => {
    const admin = await registerAndLogin("archive-router-admin-others@example.com", "super_admin");
    for (const collection of ["Payment", "ApiKey", "TokenBlacklist", "Role", "AuditLog", "Session"]) {
      const res = await request(isolatedApp)
        .post(`/api/archive/${collection}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ id: "507f1f77bcf86cd799439011" });
      expect(res.status).toBe(400);
    }
  });

  it("rejects a malformed document id with 400, not a 500 from an uncaught CastError", async () => {
    const admin = await registerAndLogin("archive-router-admin-badid@example.com", "super_admin");
    const res = await request(isolatedApp)
      .post("/api/archive/User")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ id: "not-a-valid-id" });
    expect(res.status).toBe(400);
  });

  it("rejects a missing document id with 400 rather than passing undefined through to findById", async () => {
    const admin = await registerAndLogin("archive-router-admin-missingid@example.com", "super_admin");
    const res = await request(isolatedApp)
      .post("/api/archive/User")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 for a well-formed but nonexistent archive id on restore", async () => {
    const admin = await registerAndLogin("archive-router-admin-restore404@example.com", "super_admin");
    const res = await request(isolatedApp)
      .post("/api/archive/507f1f77bcf86cd799439011/restore")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(404);
  });

  it("rejects a malformed archive id on restore with 400, not a 500", async () => {
    const admin = await registerAndLogin("archive-router-admin-restorebadid@example.com", "super_admin");
    const res = await request(isolatedApp)
      .post("/api/archive/not-a-valid-id/restore")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(400);
  });

  it("allows a genuinely allowlisted entity end-to-end (archive, then restore) — proves the mechanism works, not just that it blocks", async () => {
    const admin = await registerAndLogin("archive-router-admin-happy@example.com", "super_admin");
    const target = await registerAndLogin("archive-router-happy-target@example.com", "user");

    // Temporarily allowlist User for this one test only. Production code
    // ships with ARCHIVABLE_COLLECTIONS empty — see the note at the top
    // of archiveRoutes.js for why User specifically should NOT be added
    // for real (it already has its own audited soft-delete route).
    archiveRoutes.ARCHIVABLE_COLLECTIONS.set("User", User);

    const archiveRes = await request(isolatedApp)
      .post("/api/archive/User")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ id: target.user.id, reason: "test" });

    expect(archiveRes.status).toBe(201);
    expect(await User.findById(target.user.id)).toBeNull();

    const restoreRes = await request(isolatedApp)
      .post(`/api/archive/${archiveRes.body.data._id}/restore`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(restoreRes.status).toBe(200);
    const restoredUser = await User.findById(target.user.id);
    expect(restoredUser).not.toBeNull();
    expect(restoredUser.email).toBe("archive-router-happy-target@example.com");
  });

  it("regression: restore also enforces the allowlist, not just create — an old archive row for a non-allowlisted collection cannot be used to forge a document", async () => {
    const admin = await registerAndLogin("archive-router-admin-restoreblock@example.com", "super_admin");

    // Simulate a row written by the OLD, unpatched code — a real Archive
    // document referencing a collection that was never meant to be
    // generically restorable.
    const Archive = require("../../src/models/Archive");
    const legacyRow = await Archive.create({
      sourceCollection: "User",
      originalId: admin.user.id,
      data: { email: "forged-admin@example.com", role: "super_admin", displayName: "Forged" },
      archivedBy: admin.user.id,
    });

    const res = await request(isolatedApp)
      .post(`/api/archive/${legacyRow._id}/restore`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(400);
    expect(await User.findOne({ email: "forged-admin@example.com" })).toBeNull();
  });
});
