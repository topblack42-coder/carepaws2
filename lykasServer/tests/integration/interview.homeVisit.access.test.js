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
const User = require("../../src/models/User");
const Pet = require("../../src/models/Pet");
const Application = require("../../src/models/Application");
const UserDocument = require("../../src/models/UserDocument");
const Notification = require("../../src/models/Notification");

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

async function scheduleInterviewFor(applicant, staffToken) {
  const pet = await Pet.create({ name: "Bantay", species: "Dog", status: "Pending" });
  const application = await Application.create({
    pet: pet._id,
    applicant: applicant.user.id,
    phone: "0917000000",
    address: "123 Main St",
    status: "pending",
    stage: "document_review",
  });
  // Interview creation requires at least one verified document (see
  // interviewController.create) — set that up directly rather than
  // driving the whole upload+verify flow through the API.
  await UserDocument.create({
    user: applicant.user.id,
    application: application._id,
    type: "government_id",
    fileUrl: "https://example.com/doc.jpg",
    status: "verified",
  });

  const createRes = await request(app)
    .post("/api/interviews")
    .set("Authorization", `Bearer ${staffToken}`)
    .send({
      application: application._id.toString(),
      scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      method: "In-person",
    });
  expect(createRes.status).toBe(201);

  return { application, interviewId: createRes.body.data._id };
}

async function scheduleHomeVisitFor(applicant, staffToken) {
  const pet = await Pet.create({ name: "Luna", species: "Cat", status: "Pending" });
  const application = await Application.create({
    pet: pet._id,
    applicant: applicant.user.id,
    phone: "0917000000",
    address: "123 Main St",
    status: "pending",
    stage: "home_visit",
  });

  const createRes = await request(app)
    .post("/api/home-visits")
    .set("Authorization", `Bearer ${staffToken}`)
    .send({
      application: application._id.toString(),
      scheduledDate: new Date(Date.now() + 86400000).toISOString(),
    });
  expect(createRes.status).toBe(201);

  return { application, visitId: createRes.body.data._id };
}

describe("Interview and home visit access control (GET /:id)", () => {
  let staff;

  beforeEach(async () => {
    staff = await registerAndLogin("access-staff@example.com", "staff");
  });

  it("lets the owning applicant view their own interview", async () => {
    const applicant = await registerAndLogin("access-applicant-iv-owner@example.com");
    const { interviewId } = await scheduleInterviewFor(applicant, staff.token);

    const res = await request(app).get(`/api/interviews/${interviewId}`).set("Authorization", `Bearer ${applicant.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(interviewId);
  });

  it("lets staff view any interview", async () => {
    const applicant = await registerAndLogin("access-applicant-iv-staffview@example.com");
    const { interviewId } = await scheduleInterviewFor(applicant, staff.token);

    const res = await request(app).get(`/api/interviews/${interviewId}`).set("Authorization", `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
  });

  it("blocks a different citizen from viewing someone else's interview (regression: was an open IDOR)", async () => {
    const applicant = await registerAndLogin("access-applicant-iv-victim@example.com");
    const { interviewId } = await scheduleInterviewFor(applicant, staff.token);
    const stranger = await registerAndLogin("access-stranger-iv@example.com");

    const res = await request(app).get(`/api/interviews/${interviewId}`).set("Authorization", `Bearer ${stranger.token}`);
    expect(res.status).toBe(403);
  });

  it("lets the owning applicant view their own home visit", async () => {
    const applicant = await registerAndLogin("access-applicant-hv-owner@example.com");
    const { visitId } = await scheduleHomeVisitFor(applicant, staff.token);

    const res = await request(app).get(`/api/home-visits/${visitId}`).set("Authorization", `Bearer ${applicant.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(visitId);
  });

  it("lets staff view any home visit", async () => {
    const applicant = await registerAndLogin("access-applicant-hv-staffview@example.com");
    const { visitId } = await scheduleHomeVisitFor(applicant, staff.token);

    const res = await request(app).get(`/api/home-visits/${visitId}`).set("Authorization", `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
  });

  it("blocks a different citizen from viewing someone else's home visit (regression: was an open IDOR)", async () => {
    const applicant = await registerAndLogin("access-applicant-hv-victim@example.com");
    const { visitId } = await scheduleHomeVisitFor(applicant, staff.token);
    const stranger = await registerAndLogin("access-stranger-hv@example.com");

    const res = await request(app).get(`/api/home-visits/${visitId}`).set("Authorization", `Bearer ${stranger.token}`);
    expect(res.status).toBe(403);
  });
});

describe("Reschedule notifications fire every time, not just once (regression: dedupeKey collision)", () => {
  let staff;

  beforeEach(async () => {
    staff = await registerAndLogin("resched-staff@example.com", "staff");
  });

  it("notifies the applicant on a second interview reschedule", async () => {
    const applicant = await registerAndLogin("resched-applicant-iv@example.com");
    const { interviewId } = await scheduleInterviewFor(applicant, staff.token);

    const first = await request(app)
      .put(`/api/interviews/${interviewId}`)
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ scheduledDate: new Date(Date.now() + 2 * 86400000).toISOString() });
    expect(first.status).toBe(200);

    const second = await request(app)
      .put(`/api/interviews/${interviewId}`)
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ scheduledDate: new Date(Date.now() + 3 * 86400000).toISOString() });
    expect(second.status).toBe(200);

    // Before the fix, notifyOnce's auto-generated key never changed
    // between reschedules of the same interview, so this would be 1.
    const count = await Notification.countDocuments({
      recipient: applicant.user.id,
      type: "INTERVIEW_RESCHEDULED",
    });
    expect(count).toBe(2);
  });

  it("notifies the applicant on a second home visit reschedule", async () => {
    const applicant = await registerAndLogin("resched-applicant-hv@example.com");
    const { visitId } = await scheduleHomeVisitFor(applicant, staff.token);

    const first = await request(app)
      .put(`/api/home-visits/${visitId}`)
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ scheduledDate: new Date(Date.now() + 2 * 86400000).toISOString() });
    expect(first.status).toBe(200);

    const second = await request(app)
      .put(`/api/home-visits/${visitId}`)
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ scheduledDate: new Date(Date.now() + 3 * 86400000).toISOString() });
    expect(second.status).toBe(200);

    const count = await Notification.countDocuments({
      recipient: applicant.user.id,
      type: "HOME_VISIT_RESCHEDULED",
    });
    expect(count).toBe(2);
  });
});
