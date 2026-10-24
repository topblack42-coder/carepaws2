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
const Pet = require("../../src/models/Pet");
const Application = require("../../src/models/Application");
const Notification = require("../../src/models/Notification");
const { Event } = require("../../src/models/Event");
const { notifyOnce } = require("../../src/utils/notificationHelper");

async function registerAndLogin(email, role = "user") {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ displayName: "Notification Test", email, password: "password123" });

  // These suites exercise actions gated by requireVerifiedEmail; verification itself is covered in emailVerification.test.js.
  await User.findOneAndUpdate({ email }, { emailVerified: true });

  if (role !== "user") {
    await User.findOneAndUpdate({ email }, { role });
    const loginRes = await request(app).post("/api/auth/login").send({ email, password: "password123" });
    return { token: loginRes.body.data.accessToken, user: loginRes.body.data.user };
  }

  return { token: res.body.data.accessToken, user: res.body.data.user };
}

describe("Notification lifecycle", () => {
  it("persists an application submission notification and prevents duplicate automated events", async () => {
    const applicant = await registerAndLogin("notification-applicant@example.com");
    const pet = await Pet.create({ name: "Tala", species: "Dog", status: "Available" });

    const response = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "Test address" });

    expect(response.status).toBe(201);
    const applicationId = response.body.data._id;
    expect(await Notification.countDocuments({
      recipient: applicant.user.id,
      type: "APPLICATION_SUBMITTED",
      refModel: "Application",
      refId: applicationId,
    })).toBe(1);

    await notifyOnce({
      recipient: applicant.user.id,
      type: "APPLICATION_SUBMITTED",
      title: "Application submitted",
      message: "Duplicate should not be created.",
      refModel: "Application",
      refId: applicationId,
    });

    expect(await Notification.countDocuments({
      recipient: applicant.user.id,
      type: "APPLICATION_SUBMITTED",
      refModel: "Application",
      refId: applicationId,
    })).toBe(1);
  });

  it("persists an event registration notification", async () => {
    const user = await registerAndLogin("notification-event@example.com");
    const event = await Event.create({
      title: "CarePaws Test Event",
      category: "Community",
      date: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdBy: user.user.id,
    });

    const response = await request(app)
      .post(`/api/events/${event._id}/register`)
      .set("Authorization", `Bearer ${user.token}`);

    expect(response.status).toBe(201);
    expect(await Notification.countDocuments({
      recipient: user.user.id,
      type: "EVENT_REGISTRATION",
      refModel: "Event",
      refId: event._id,
    })).toBe(1);
  });
});
