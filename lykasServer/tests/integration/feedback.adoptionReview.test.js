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
const Pet = require("../../src/models/Pet");
const Application = require("../../src/models/Application");

async function registerAndLogin(email, role = "user") {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ displayName: "Test " + role, email, password: "password123" });

  // These suites exercise actions gated by requireVerifiedEmail; verification itself is covered in emailVerification.test.js.
  await User.findOneAndUpdate({ email }, { emailVerified: true });

  if (role !== "user") {
    await User.findOneAndUpdate({ email }, { role });
    // Log in again to get a token carrying the updated role.
    const loginRes = await request(app).post("/api/auth/login").send({ email, password: "password123" });
    return { token: loginRes.body.data.accessToken, user: loginRes.body.data.user };
  }

  return { token: res.body.data.accessToken, user: res.body.data.user };
}

describe("Post-adoption review", () => {
  let userToken, otherToken, application;

  beforeEach(async () => {
    const user = await registerAndLogin("adopter@example.com", "user");
    const other = await registerAndLogin("stranger@example.com", "user");
    userToken = user.token;
    otherToken = other.token;
    const pet = await Pet.create({ name: "Bantay", species: "Dog", status: "Adopted" });
    application = await Application.create({
      pet: pet._id,
      applicant: user.user.id,
      type: "adoption",
      phone: "0917000000",
      address: "123 Main St",
      status: "approved",
      stage: "completed",
    });
  });

  const post = (token, body) =>
    request(app).post("/api/feedback").set("Authorization", `Bearer ${token}`).send(body);

  it("lets the adopter review a completed adoption once, linked to the pet", async () => {
    const res = await post(userToken, { type: "review", rating: 5, message: "Great!", application: application._id.toString() });
    expect(res.status).toBe(201);
    expect(String(res.body.data.relatedPet)).toBe(String(application.pet));

    const again = await post(userToken, { type: "review", rating: 4, message: "Again", application: application._id.toString() });
    expect(again.status).toBe(409);
  });

  it("rejects reviews from someone else or before the adoption is completed", async () => {
    const stranger = await post(otherToken, { type: "review", rating: 5, message: "Hi", application: application._id.toString() });
    expect(stranger.status).toBe(404);

    await Application.updateOne({ _id: application._id }, { stage: "adoption_scheduled" });
    const early = await post(userToken, { type: "review", rating: 5, message: "Too soon", application: application._id.toString() });
    expect(early.status).toBe(409);
  });
});
