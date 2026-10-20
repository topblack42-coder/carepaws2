const request = require("supertest");

// Rate limiters need Redis; mock them as passthrough like the other suites.
// The per-IP resend limiter is therefore not exercised here; the per-user
// cooldown/cap (the part that lives in the database) is.
jest.mock("../../src/middleware/rateLimitMiddleware", () => ({
  globalLimiter: (req, res, next) => next(),
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  passwordResetLimiter: (req, res, next) => next(),
  resendVerificationLimiter: (req, res, next) => next(),
  webhookLimiter: (req, res, next) => next(),
}));

// Capture outgoing mail so tests can read the raw token and simulate failures.
jest.mock("../../src/utils/emailService", () => ({
  sendTemplatedEmail: jest.fn(),
  sendRawEmail: jest.fn(),
  renderTemplate: jest.fn(),
}));

const { app } = require("../../src/server");
const User = require("../../src/models/User");
const Pet = require("../../src/models/Pet");
const { sendTemplatedEmail } = require("../../src/utils/emailService");
const { requireVerifiedEmail } = require("../../src/middleware/authMiddleware");

function lastToken() {
  const call = sendTemplatedEmail.mock.calls[sendTemplatedEmail.mock.calls.length - 1];
  return /token=([a-f0-9]+)/.exec(call[0].data.verifyUrl)[1];
}

async function register(email = "member@example.com") {
  const res = await request(app).post("/api/auth/register").send({ displayName: "Member", email, password: "password123" });
  return { res, token: res.body.data?.accessToken };
}

const post = (path, token) => request(app).post(path).set("Authorization", `Bearer ${token}`);

beforeEach(() => {
  process.env.MOBILE_APP_URL = "carepaws://";
  sendTemplatedEmail.mockReset();
  sendTemplatedEmail.mockResolvedValue({ emailSkipped: false });
});

describe("register email result", () => {
  it("reports emailSent: true when the email goes out", async () => {
    const { res } = await register();
    expect(res.status).toBe(201);
    expect(res.body.data.emailSent).toBe(true);
    expect(res.body.data.emailSkipped).toBe(false);
  });

  it("keeps the account and reports emailSent: false when sending fails", async () => {
    sendTemplatedEmail.mockResolvedValue({ emailSkipped: true, reason: "send_failed" });
    const { res } = await register("failed@example.com");
    expect(res.status).toBe(201);
    expect(res.body.data.emailSent).toBe(false);
    expect(res.body.data.emailSkipped).toBe(true);
    expect(await User.findOne({ email: "failed@example.com" })).toBeTruthy();
  });

  it("stores only a hash of the token", async () => {
    await register();
    const raw = lastToken();
    const user = await User.findOne({ email: "member@example.com" }).select("+emailVerificationToken");
    expect(user.emailVerificationToken).toBeTruthy();
    expect(user.emailVerificationToken).not.toBe(raw);
  });
});

describe("POST /api/auth/resend-verification", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/api/auth/resend-verification");
    expect(res.status).toBe(401);
  });

  it("sends a fresh email for an unverified user", async () => {
    const { token } = await register();
    sendTemplatedEmail.mockClear();

    const res = await post("/api/auth/resend-verification", token);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.emailSkipped).toBe(false);
    expect(sendTemplatedEmail).toHaveBeenCalledTimes(1);
    expect(sendTemplatedEmail.mock.calls[0][0].templateKey).toBe("verify_email");
  });

  it("is a no-op for an already verified user", async () => {
    const { token } = await register();
    await User.updateOne({ email: "member@example.com" }, { emailVerified: true });
    sendTemplatedEmail.mockClear();

    const res = await post("/api/auth/resend-verification", token);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Email already verified");
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("invalidates the previous token when a new one is issued", async () => {
    const { token } = await register();
    const oldToken = lastToken();
    // Skip the cooldown the way time would.
    await User.updateOne({ email: "member@example.com" }, { emailVerificationLastSentAt: new Date(Date.now() - 61 * 1000) });

    const res = await post("/api/auth/resend-verification", token);
    expect(res.status).toBe(200);
    const newToken = lastToken();
    expect(newToken).not.toBe(oldToken);

    const stale = await request(app).post("/api/auth/verify-email").send({ token: oldToken });
    expect(stale.status).toBe(400);

    const fresh = await request(app).post("/api/auth/verify-email").send({ token: newToken });
    expect(fresh.status).toBe(200);
    expect((await User.findOne({ email: "member@example.com" })).emailVerified).toBe(true);

    // Single use.
    const again = await request(app).post("/api/auth/verify-email").send({ token: newToken });
    expect(again.status).toBe(400);
  });

  it("enforces the 60-second gap and returns retryAfterSeconds", async () => {
    const { token } = await register();
    const first = await post("/api/auth/resend-verification", token);
    expect(first.status).toBe(200);

    sendTemplatedEmail.mockClear();
    const second = await post("/api/auth/resend-verification", token);
    expect(second.status).toBe(429);
    expect(second.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(second.body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("caps sends at 3 per 15 minutes even when the gap has passed", async () => {
    const { token } = await register();
    const clearGap = () =>
      User.updateOne({ email: "member@example.com" }, { emailVerificationLastSentAt: new Date(Date.now() - 61 * 1000) });

    for (let i = 0; i < 3; i++) {
      await clearGap();
      const ok = await post("/api/auth/resend-verification", token);
      expect(ok.status).toBe(200);
    }

    await clearGap();
    sendTemplatedEmail.mockClear();
    const limited = await post("/api/auth/resend-verification", token);
    expect(limited.status).toBe(429);
    expect(limited.body.retryAfterSeconds).toBeGreaterThan(60);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("returns 502 instead of success when the email provider fails", async () => {
    const { token } = await register();
    await User.updateOne({ email: "member@example.com" }, { emailVerificationLastSentAt: new Date(Date.now() - 61 * 1000) });
    sendTemplatedEmail.mockResolvedValue({ emailSkipped: true, reason: "send_failed" });

    const res = await post("/api/auth/resend-verification", token);
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });
});

describe("requireVerifiedEmail", () => {
  function run(user) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    requireVerifiedEmail({ user }, res, next);
    return { res, next };
  }

  it("returns 403 EMAIL_NOT_VERIFIED for an unverified member", () => {
    const { res, next } = run({ role: "user", emailVerified: false });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, code: "EMAIL_NOT_VERIFIED", message: "Please verify your email to continue" });
  });

  it("passes verified members and staff/admin accounts", () => {
    expect(run({ role: "user", emailVerified: true }).next).toHaveBeenCalled();
    expect(run({ role: "staff", emailVerified: false }).next).toHaveBeenCalled();
    expect(run({ role: "admin", emailVerified: false }).next).toHaveBeenCalled();
  });
});

describe("gated and exempt routes for an unverified member", () => {
  let token;
  let pet;

  beforeEach(async () => {
    ({ token } = await register());
    pet = await Pet.create({ name: "Bella", species: "Dog", status: "Available" });
  });

  it("blocks adoption and foster applications, appointment enrolment and volunteer signup", async () => {
    const body = { pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" };
    const adopt = await post("/api/applications", token).send(body);
    const foster = await post("/api/applications", token).send({ ...body, type: "foster", fosterPeriod: "4 weeks" });
    const enroll = await post("/api/appointments/000000000000000000000000/enroll", token).send({});
    const volunteer = await post("/api/volunteers/register", token).send({});

    for (const res of [adopt, foster, enroll, volunteer]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
    }
    expect((await Pet.findById(pet._id)).status).toBe("Available");
  });

  it("lets an application through once the email is verified", async () => {
    await User.updateOne({ email: "member@example.com" }, { emailVerified: true });
    const res = await post("/api/applications", token).send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });
    expect(res.status).toBe(201);
  });

  it("still allows profile read, browsing, logout and resend", async () => {
    const authed = (path) => request(app).get(path).set("Authorization", `Bearer ${token}`);

    expect((await authed("/api/auth/me")).status).toBe(200);
    expect((await authed("/api/pets")).status).toBe(200);
    expect((await post("/api/auth/resend-verification", token)).status).toBe(200);
    expect((await post("/api/auth/logout", token)).status).toBe(200);
  });
});
