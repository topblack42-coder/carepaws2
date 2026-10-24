const request = require("supertest");

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
const Payment = require("../../src/models/Payment");

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

// Regression coverage for gaps identified during the donation audit:
// payment.webhook.test.js covers the webhook state machine and
// idempotency, but nothing exercised ownership scoping or the
// create-checkout amount validator at the HTTP layer — both are
// explicitly required coverage. Both were already correct by reading
// the source (paidBy: req.user._id scoping; createCheckoutSchema's
// z.number().int().positive()); this locks that behavior in.
describe("Payment: ownership scoping", () => {
  let owner, stranger, staff, payment;

  beforeEach(async () => {
    owner = await registerAndLogin("owner@example.com", "user");
    stranger = await registerAndLogin("stranger@example.com", "user");
    staff = await registerAndLogin("staff@example.com", "staff");

    payment = await Payment.create({
      paidBy: owner.user.id,
      type: "donation",
      amount: 20000,
      description: "Donation",
      status: "pending",
    });
  });

  it("lets the paying user fetch their own payment detail", async () => {
    const res = await request(app)
      .get(`/api/payments/my/${payment._id}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(payment._id.toString());
  });

  it("does not let a different user fetch someone else's payment detail", async () => {
    const res = await request(app)
      .get(`/api/payments/my/${payment._id}`)
      .set("Authorization", `Bearer ${stranger.token}`);
    expect(res.status).toBe(404);
  });

  it("does not include another user's payment in the caller's own payment list", async () => {
    const res = await request(app)
      .get("/api/payments/my")
      .set("Authorization", `Bearer ${stranger.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.find((p) => p._id === payment._id.toString())).toBeUndefined();
  });

  it("blocks a non-admin from the staff-only all-payments list", async () => {
    const res = await request(app).get("/api/payments").set("Authorization", `Bearer ${owner.token}`);
    expect(res.status).toBe(403);
  });

  it("blocks a non-admin from the staff-only single-payment lookup by id", async () => {
    const res = await request(app)
      .get(`/api/payments/${payment._id}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(res.status).toBe(403);
  });

  it("allows staff to use the admin single-payment lookup by id", async () => {
    const res = await request(app)
      .get(`/api/payments/${payment._id}`)
      .set("Authorization", `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(payment._id.toString());
  });
});

describe("Payment: create-checkout amount validation", () => {
  let buyer;

  beforeEach(async () => {
    buyer = await registerAndLogin("buyer2@example.com", "user");
  });

  async function attempt(body) {
    return request(app)
      .post("/api/payments/create-checkout")
      .set("Authorization", `Bearer ${buyer.token}`)
      .send({ type: "donation", description: "Test donation", ...body });
  }

  it("rejects a zero amount", async () => {
    const res = await attempt({ amount: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects a negative amount", async () => {
    const res = await attempt({ amount: -500 });
    expect(res.status).toBe(400);
  });

  it("rejects a decimal (non-integer centavos) amount", async () => {
    const res = await attempt({ amount: 100.5 });
    expect(res.status).toBe(400);
  });

  it("rejects a missing amount", async () => {
    const res = await attempt({});
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric amount", async () => {
    const res = await attempt({ amount: "not-a-number" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid donation type", async () => {
    const res = await attempt({ amount: 500, type: "not_a_real_type" });
    expect(res.status).toBe(400);
  });

  it("none of the above rejections create a Payment record", async () => {
    await attempt({ amount: 0 });
    await attempt({ amount: -500 });
    await attempt({});
    const count = await Payment.countDocuments({ paidBy: buyer.user.id });
    expect(count).toBe(0);
  });

  it("passes validation for a well-formed amount (fails later at the unconfigured gateway, not at validation)", async () => {
    // PAYMONGO_SECRET_KEY is intentionally unset in the test environment
    // (see payment.webhook.test.js) - this confirms the 503 comes from
    // the gateway-not-configured check, not from validation rejecting a
    // valid amount.
    const res = await attempt({ amount: 25000 });
    expect(res.status).toBe(503);
  });
});
<<<<<<< HEAD

// Regression test for the reported bug: opening Payment History showed a
// spinner, then "Something went wrong — User no longer exists", then force-
// logged the user out. Root cause was in auth (login/googleAuth issuing a
// session to a soft-deleted account — see authController.js), not here, but
// this locks in the actual user-facing contract at the endpoint the mobile
// Payment History screen calls: GET /api/payments/my must always settle —
// with real data, or with a clean error — and must never leave the caller
// hanging, no matter what state the account is in.
describe("Payment: GET /api/payments/my always resolves (never hangs)", () => {
  it("resolves with the caller's records for a healthy account", async () => {
    const user = await registerAndLogin("healthy@example.com", "user");
    await Payment.create({ paidBy: user.user.id, type: "donation", amount: 10000, status: "paid" });

    const res = await request(app).get("/api/payments/my").set("Authorization", `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it("resolves with an empty array (not an error, not a hang) when the caller has no payments", async () => {
    const user = await registerAndLogin("nopayments@example.com", "user");

    const res = await request(app).get("/api/payments/my").set("Authorization", `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("rejects promptly with 401 for a token whose account was deleted after the token was issued — the exact scenario from the report", async () => {
    const user = await registerAndLogin("deleted-mid-session@example.com", "user");

    // The session was legitimately established while the account was fine —
    // exactly like the video, where sign-in and the profile screen worked.
    const before = await request(app).get("/api/payments/my").set("Authorization", `Bearer ${user.token}`);
    expect(before.status).toBe(200);

    await User.findByIdAndUpdate(user.user.id, { isDeleted: true });

    const after = await request(app).get("/api/payments/my").set("Authorization", `Bearer ${user.token}`);
    expect(after.status).toBe(401);
    expect(after.body.success).toBe(false);
    expect(after.body.message).toBe("User no longer exists");
  });

  it("rejects with 401 rather than hanging when no token is supplied at all", async () => {
    const res = await request(app).get("/api/payments/my");
    expect(res.status).toBe(401);
  });
});
=======
>>>>>>> a184c99c9d56f42b9a2ad9e59e8d9739f6eceb3f
