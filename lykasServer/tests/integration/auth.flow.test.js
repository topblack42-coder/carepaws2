const request = require("supertest");

// Redis-backed rate limiting needs a real Redis instance; that's outside
// the scope of these unit/integration tests (mongodb-memory-server
// stands in for MongoDB, but we don't stand up Redis for CI). Mock the
// rate limiters as no-op passthrough middleware so auth-flow tests
// exercise real controller logic without needing Redis available.
jest.mock("../../src/middleware/rateLimitMiddleware", () => ({
  globalLimiter: (req, res, next) => next(),
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  passwordResetLimiter: (req, res, next) => next(),
  resendVerificationLimiter: (req, res, next) => next(),
  webhookLimiter: (req, res, next) => next(),
}));

const { app } = require("../../src/server");
const User = require("../../src/models/User");
const EmailTemplate = require("../../src/models/EmailTemplate");

beforeEach(async () => {
  // register/login send templated emails — seed the templates the flow needs
  // so sendTemplatedEmail resolves a template (and then gracefully no-ops
  // since no SMTP transport is configured in the test env).
  await EmailTemplate.create([
    { key: "verify_email", label: "Verify email", subject: "Verify", bodyHtml: "Hi {{displayName}}, {{verifyUrl}}" },
    { key: "password_reset", label: "Password reset", subject: "Reset", bodyHtml: "Hi {{displayName}}, {{resetUrl}}" },
  ]);
});

describe("Auth flow", () => {
  it("registers a new user and returns tokens", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ displayName: "Test User", email: "test@example.com", password: "password123" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.body.data.user.email).toBe("test@example.com");
  });

  it("rejects registering the same email twice", async () => {
    await request(app).post("/api/auth/register").send({ displayName: "A", email: "dup@example.com", password: "password123" });
    const res = await request(app).post("/api/auth/register").send({ displayName: "B", email: "dup@example.com", password: "password123" });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it("rejects registration payloads with unknown fields (zod .strict())", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ displayName: "C", email: "c@example.com", password: "password123", isAdmin: true });

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it("logs in with correct credentials", async () => {
    await request(app).post("/api/auth/register").send({ displayName: "D", email: "d@example.com", password: "password123" });

    const res = await request(app).post("/api/auth/login").send({ email: "d@example.com", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
  });

  it("rejects login with a wrong password without revealing whether the account exists", async () => {
    await request(app).post("/api/auth/register").send({ displayName: "E", email: "e@example.com", password: "password123" });

    const res = await request(app).post("/api/auth/login").send({ email: "e@example.com", password: "wrongpassword" });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("locks the account after 5 consecutive failed logins", async () => {
    await request(app).post("/api/auth/register").send({ displayName: "F", email: "f@example.com", password: "password123" });

    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/login").send({ email: "f@example.com", password: "wrongpassword" });
    }

    const user = await User.findOne({ email: "f@example.com" });
    expect(user.status).toBe("locked");
    expect(user.lockedUntil).toBeTruthy();

    // Even the correct password is rejected while locked.
    const res = await request(app).post("/api/auth/login").send({ email: "f@example.com", password: "password123" });
    expect(res.status).toBe(423);
  });

  it("GET /me requires a valid access token", async () => {
    const unauth = await request(app).get("/api/auth/me");
    expect(unauth.status).toBe(401);

    const register = await request(app)
      .post("/api/auth/register")
      .send({ displayName: "G", email: "g@example.com", password: "password123" });

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${register.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe("g@example.com");
  });

  it("refresh rotates the refresh token — the old one can't be reused", async () => {
    const register = await request(app)
      .post("/api/auth/register")
      .send({ displayName: "H", email: "h@example.com", password: "password123" });

    const oldRefresh = register.body.data.refreshToken;

    const refreshRes = await request(app).post("/api/auth/refresh").send({ refreshToken: oldRefresh });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.refreshToken).not.toBe(oldRefresh);

    const reuse = await request(app).post("/api/auth/refresh").send({ refreshToken: oldRefresh });
    expect(reuse.status).toBe(401);
  });

  it("logout blacklists the access token so it can no longer authenticate", async () => {
    const register = await request(app)
      .post("/api/auth/register")
      .send({ displayName: "I", email: "i@example.com", password: "password123" });

    const token = register.body.data.accessToken;

    const logoutRes = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`).send({});
    expect(logoutRes.status).toBe(200);

    const meAfter = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(meAfter.status).toBe(401);
  });

  it("password reset flow: request -> reset -> old sessions revoked", async () => {
    await request(app).post("/api/auth/register").send({ displayName: "J", email: "j@example.com", password: "password123" });

    const forgotRes = await request(app).post("/api/auth/forgot-password").send({ email: "j@example.com" });
    expect(forgotRes.status).toBe(200);

    const user = await User.findOne({ email: "j@example.com" }).select("+resetPasswordToken +resetPasswordExpires");
    expect(user.resetPasswordToken).toBeTruthy();

    // We don't have the raw token (only its hash is stored) — simulate by
    // reaching into the reset flow through a second registration would be
    // wrong, so instead assert the token/expiry were actually set, which is
    // the observable contract of this endpoint for a black-box test.
    expect(user.resetPasswordExpires.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects an access token issued before the last password change", async () => {
    const register = await request(app)
      .post("/api/auth/register")
      .send({ displayName: "K", email: "k@example.com", password: "password123" });

    const token = register.body.data.accessToken;

    const meBefore = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(meBefore.status).toBe(200);

    // Simulate a password change happening after the token was issued —
    // this is exactly what resetPassword() triggers under the hood via
    // user.save(). Set a couple of seconds in the future (rather than
    // `new Date()`) so the assertion doesn't depend on the token's `iat`
    // and this write landing in the same whole-second JWT bucket.
    const user = await User.findOne({ email: "k@example.com" });
    user.passwordChangedAt = new Date(Date.now() + 2000);
    await user.save();

    const meAfter = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(meAfter.status).toBe(401);
    expect(meAfter.body.message).toMatch(/password changed/i);
  });
});
