const request = require("supertest");

jest.mock("../../src/middleware/rateLimitMiddleware", () => ({
  globalLimiter: (req, res, next) => next(),
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  passwordResetLimiter: (req, res, next) => next(),
  resendVerificationLimiter: (req, res, next) => next(),
  webhookLimiter: (req, res, next) => next(),
}));

// authController requires google-auth-library at module load time to build
// its OAuth2Client singleton, so it has to be stubbed before ../../src/server
// is required — a real ID token isn't available (or desirable) in tests.
const verifyIdToken = jest.fn();
jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken })),
}));

const { app } = require("../../src/server");
const User = require("../../src/models/User");

/**
 * Regression coverage for the reported bug: the mobile app's Payment
 * History screen showed a spinner, then briefly "Something went wrong —
 * User no longer exists", then force-logged the user out back to the
 * login screen.
 *
 * Root cause: login() and googleAuth() were the only two session-issuing
 * entry points that didn't check `isDeleted` — refresh() and
 * authMiddleware.protect() both already did. A soft-deleted account could
 * therefore sign in successfully (the profile screen renders fine off the
 * login response's own embedded user object) and receive a fully valid
 * access+refresh token pair, which then failed with 401 "User no longer
 * exists" on the very first genuinely protect()-gated request afterward —
 * in the reported case, opening Payment History. The client's axios
 * interceptor correctly treats that as an expired session (its own
 * behavior is covered separately in lykasUser/__tests__/api-interceptor.
 * test.ts) and signs the user out, which is what produced the abrupt
 * "kicked back to login" jump.
 *
 * See authController.js login() / googleAuth() for the fix. The
 * corresponding "never hangs" contract at the Payment History endpoint
 * itself is covered in payment.access.test.js.
 */
describe("Deleted accounts cannot obtain or use a session", () => {
  it("login rejects a soft-deleted account the same way it rejects a nonexistent one, and issues no tokens", async () => {
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ displayName: "Deleted User", email: "deleted@example.com", password: "password123" });
    expect(reg.status).toBe(201);

    await User.findOneAndUpdate({ email: "deleted@example.com" }, { isDeleted: true });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "deleted@example.com", password: "password123" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Invalid email or password");
    expect(res.body.data).toBeUndefined();
  });

  it("googleAuth rejects a soft-deleted account instead of issuing it a session", async () => {
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ displayName: "Deleted Googler", email: "deleted-google@example.com", password: "password123" });
    expect(reg.status).toBe(201);

    await User.findOneAndUpdate({ email: "deleted-google@example.com" }, { isDeleted: true });
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "deleted-google@example.com" }) });

    const res = await request(app).post("/api/auth/google").send({ idToken: "fake-token-for-test" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeUndefined();
  });

  it("does not resurrect a deleted account's data as a side effect of a rejected Google sign-in attempt", async () => {
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ displayName: "Deleted Googler Two", email: "deleted-google-2@example.com", password: "password123" });
    await User.findOneAndUpdate({ email: "deleted-google-2@example.com" }, { isDeleted: true, emailVerified: false });
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "deleted-google-2@example.com" }) });

    await request(app).post("/api/auth/google").send({ idToken: "fake-token-for-test" });

    const user = await User.findById(reg.body.data.user.id);
    expect(user.isDeleted).toBe(true);
    expect(user.emailVerified).toBe(false); // googleAuth's auto-verify-on-login must not have run
  });

  it("a token that was genuinely valid when issued stops working the moment the account is deleted — cleanly (401), not by hanging", async () => {
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ displayName: "Soon Deleted", email: "soon-deleted@example.com", password: "password123" });
    const token = reg.body.data.accessToken;

    const before = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(before.status).toBe(200);

    await User.findOneAndUpdate({ email: "soon-deleted@example.com" }, { isDeleted: true });

    const after = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(401);
    expect(after.body.message).toBe("User no longer exists");
  });

  it("a healthy, active account can still log in normally (the fix does not block real users)", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ displayName: "Still Fine", email: "still-fine@example.com", password: "password123" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "still-fine@example.com", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
  });
});
