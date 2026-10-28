const request = require("supertest");

jest.mock("../../src/middleware/rateLimitMiddleware", () => ({
  globalLimiter: (req, res, next) => next(),
  loginLimiter: (req, res, next) => next(),
  passwordResetLimiter: (req, res, next) => next(),
  resendVerificationLimiter: (req, res, next) => next(),
  resetLinkLimiter: (req, res, next) => next(),
  webhookLimiter: (req, res, next) => next(),
}));

const { app } = require("../../src/server");
const User = require("../../src/models/User");
const Pet = require("../../src/models/Pet");
const Application = require("../../src/models/Application");
const { Foster, WeeklyFosterReport, getFosterReportDueDate } = require("../../src/models/Foster");
const Notification = require("../../src/models/Notification");
const { runFosterReportMonitoring } = require("../../src/jobs/reminderJobs");

async function registerAndLogin(email, role = "user") {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ displayName: `Test ${role}`, email, password: "password123" });

  // These suites exercise actions gated by requireVerifiedEmail; verification itself is covered in emailVerification.test.js.
  await User.findOneAndUpdate({ email }, { emailVerified: true });

  if (role !== "user") {
    await User.findOneAndUpdate({ email }, { role });
    const loginRes = await request(app).post("/api/auth/login").send({ email, password: "password123" });
    return { token: loginRes.body.data.accessToken, user: loginRes.body.data.user };
  }

  return { token: res.body.data.accessToken, user: res.body.data.user };
}

async function createApprovedFosterApplication(applicantToken, staffToken, pet) {
  const submitted = await request(app)
    .post("/api/applications")
    .set("Authorization", `Bearer ${applicantToken}`)
    .send({
      pet: pet._id.toString(),
      type: "foster",
      phone: "0917000000",
      address: "123 Main St",
    });

  expect(submitted.status).toBe(201);

  for (const stage of ["document_review", "interview", "home_visit", "risk_assessment"]) {
    const moved = await request(app)
      .put(`/api/applications/${submitted.body.data._id}/stage`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ stage });
    expect(moved.status).toBe(200);
  }

  const approved = await request(app)
    .put(`/api/applications/${submitted.body.data._id}/status`)
    .set("Authorization", `Bearer ${staffToken}`)
    .send({ status: "approved" });

  expect(approved.status).toBe(200);
  return approved.body.data;
}

async function schedulePickup(staffToken, applicationId, scheduledDate = "2026-08-23T09:00:00.000Z") {
  const res = await request(app)
    .post("/api/adoption-pickups")
    .set("Authorization", `Bearer ${staffToken}`)
    .send({ application: applicationId, scheduledDate, method: "Shelter pickup" });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe("Foster placement pipeline", () => {
  let applicantToken;
  let staffToken;
  let applicantUserId;
  let pet;

  beforeEach(async () => {
    const applicant = await registerAndLogin("foster-applicant@example.com");
    const staff = await registerAndLogin("foster-staff@example.com", "staff");
    applicantToken = applicant.token;
    applicantUserId = applicant.user.id;
    staffToken = staff.token;
    pet = await Pet.create({ name: "Bantay", species: "Dog", status: "Available" });
  });

  it("creates a placement only from the approved foster application and tracks a 30-day trial", async () => {
    const application = await createApprovedFosterApplication(applicantToken, staffToken, pet);
    await schedulePickup(staffToken, application._id);

    const startDate = new Date("2026-08-23T00:00:00.000Z");
    const res = await request(app)
      .post("/api/foster")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        application: application._id,
        pet: pet._id.toString(),
        fosterer: applicantUserId,
        startDate: startDate.toISOString(),
        trialDurationDays: 30,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.application.toString()).toBe(application._id.toString());
    expect(res.body.data.pet.toString()).toBe(pet._id.toString());
    expect(res.body.data.fosterer.toString()).toBe(applicantUserId.toString());
    expect(res.body.data.trialDurationDays).toBe(30);
    expect(new Date(res.body.data.expectedEndDate).toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(res.body.data.weeklyReportsRequired).toBe(5);

    const stored = await Foster.findById(res.body.data._id);
    expect(stored.weeklyReportsSubmitted).toBe(0);
  });

  it("rejects placement from an unapproved or mismatched application", async () => {
    const pending = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({
        pet: pet._id.toString(),
        type: "foster",
        phone: "0917000000",
        address: "123 Main St",
      });

    const res = await request(app)
      .post("/api/foster")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        application: pending.body.data._id,
        pet: pet._id.toString(),
        fosterer: applicantUserId,
        startDate: "2026-08-23T00:00:00.000Z",
        trialDurationDays: 30,
      });

    expect(res.status).toBe(409);
    expect(await Foster.countDocuments()).toBe(0);
  });

  it("persists one report per week and derives the submitted count from stored reports", async () => {
    const application = await createApprovedFosterApplication(applicantToken, staffToken, pet);
    await schedulePickup(staffToken, application._id);
    const placement = await request(app)
      .post("/api/foster")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        application: application._id,
        pet: pet._id.toString(),
        fosterer: applicantUserId,
        startDate: "2026-08-23T00:00:00.000Z",
        trialDurationDays: 30,
      });

    expect(placement.status).toBe(201);

    const report = await request(app)
      .post(`/api/foster/${placement.body.data._id}/reports`)
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ weekNumber: 1, overallProgress: "Good", notes: "Settling in well." });

    expect(report.status).toBe(201);
    expect(await WeeklyFosterReport.countDocuments({ foster: placement.body.data._id })).toBe(1);
    expect((await Foster.findById(placement.body.data._id)).weeklyReportsSubmitted).toBe(1);

    const second = await request(app)
      .post(`/api/foster/${placement.body.data._id}/reports`)
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ weekNumber: 2, overallProgress: "Good" });
    expect(second.status).toBe(201);
    expect((await Foster.findById(placement.body.data._id)).weeklyReportsSubmitted).toBe(2);

    const duplicate = await request(app)
      .post(`/api/foster/${placement.body.data._id}/reports`)
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ weekNumber: 1, overallProgress: "Good" });
    expect(duplicate.status).toBe(409);

    const list = await request(app)
      .get(`/api/foster/${placement.body.data._id}/reports`)
      .set("Authorization", `Bearer ${applicantToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].weekNumber).toBe(1);
    expect(list.body.data[1].weekNumber).toBe(2);
  });

  it("does not allow a completed foster without a valid trial period", async () => {
    const foster = await Foster.create({
      pet: pet._id,
      fosterer: applicantUserId,
      startDate: new Date("2026-08-23T00:00:00.000Z"),
      status: "active",
    });

    const res = await request(app)
      .put(`/api/foster/${foster._id}/end`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ outcome: "RETURNED" });

    expect(res.status).toBe(409);
    expect((await Foster.findById(foster._id)).status).toBe("active");
  });
  it("calculates weekly due dates from the trial start/end and stops at the trial end", async () => {
    const foster = await Foster.create({
      pet: pet._id,
      fosterer: applicantUserId,
      application: new (require("mongoose").Types.ObjectId)(),
      startDate: new Date("2026-08-23T00:00:00.000Z"),
      expectedEndDate: new Date("2026-09-22T00:00:00.000Z"),
      trialDurationDays: 30,
      weeklyReportsRequired: 5,
    });

    expect(getFosterReportDueDate(foster, 1).toISOString()).toBe("2026-08-30T00:00:00.000Z");
    expect(getFosterReportDueDate(foster, 4).toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(getFosterReportDueDate(foster, 5).toISOString()).toBe("2026-09-22T00:00:00.000Z");
  });

  it("marks due missing reports overdue and does not duplicate staff notifications", async () => {
    const fosterer = await User.findOne({ email: "foster-applicant@example.com" });
    const staff = await User.findOne({ email: "foster-staff@example.com" });
    const foster = await Foster.create({
      pet: pet._id,
      fosterer: fosterer._id,
      application: new (require("mongoose").Types.ObjectId)(),
      startDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      expectedEndDate: new Date(Date.now() + 22 * 24 * 60 * 60 * 1000),
      trialDurationDays: 30,
      weeklyReportsRequired: 5,
    });

    await runFosterReportMonitoring();
    const first = await WeeklyFosterReport.findOne({ foster: foster._id, weekNumber: 1 });
    expect(first.status).toBe("overdue");
    expect(first.dueDate).toBeTruthy();
    expect(await Notification.countDocuments({ recipient: staff._id, refId: foster._id, type: "FOSTER_REPORT_DUE" })).toBe(1);

    await runFosterReportMonitoring();
    expect(await Notification.countDocuments({ recipient: staff._id, refId: foster._id, type: "FOSTER_REPORT_DUE" })).toBe(1);
  });

  it("marks a submitted report submitted and excludes it from overdue monitoring", async () => {
    const fosterer = await User.findOne({ email: "foster-applicant@example.com" });
    const foster = await Foster.create({
      pet: pet._id,
      fosterer: fosterer._id,
      application: new (require("mongoose").Types.ObjectId)(),
      startDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      expectedEndDate: new Date(Date.now() + 22 * 24 * 60 * 60 * 1000),
      trialDurationDays: 30,
      weeklyReportsRequired: 5,
    });

    await WeeklyFosterReport.create({
      foster: foster._id,
      pet: foster.pet,
      fosterer: foster.fosterer,
      weekNumber: 1,
      dueDate: getFosterReportDueDate(foster, 1),
      status: "submitted",
      reportDate: new Date(),
      submittedAt: new Date(),
      overallProgress: "Good",
    });

    await runFosterReportMonitoring();
    expect(await WeeklyFosterReport.countDocuments({ foster: foster._id, status: "overdue" })).toBe(0);
    expect((await Foster.findById(foster._id)).weeklyReportsSubmitted).toBe(1);
  });

  it("stops monitoring completed and cancelled fosters", async () => {
    const fosterer = await User.findOne({ email: "foster-applicant@example.com" });
    for (const status of ["completed", "cancelled"]) {
      const foster = await Foster.create({
        pet: pet._id,
        fosterer: fosterer._id,
        application: new (require("mongoose").Types.ObjectId)(),
        startDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        expectedEndDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        trialDurationDays: 30,
        weeklyReportsRequired: 5,
        status,
        endDate: new Date(),
        closedAt: new Date(),
      });
      await runFosterReportMonitoring();
      expect(await WeeklyFosterReport.countDocuments({ foster: foster._id })).toBe(0);
    }
  });

  it("requires a scheduled pickup, and the foster period cannot start before it", async () => {
    const application = await createApprovedFosterApplication(applicantToken, staffToken, pet);
    const body = {
      application: application._id,
      pet: pet._id.toString(),
      fosterer: applicantUserId,
      startDate: "2026-08-23T00:00:00.000Z",
      trialDurationDays: 30,
    };

    const noPickup = await request(app).post("/api/foster").set("Authorization", `Bearer ${staffToken}`).send(body);
    expect(noPickup.status).toBe(409);

    await schedulePickup(staffToken, application._id, "2026-08-25T09:00:00.000Z");
    const tooEarly = await request(app).post("/api/foster").set("Authorization", `Bearer ${staffToken}`).send(body);
    expect(tooEarly.status).toBe(409);
    expect(await Foster.countDocuments()).toBe(0);
  });

  it("moves the foster period when its pickup is rescheduled", async () => {
    const application = await createApprovedFosterApplication(applicantToken, staffToken, pet);
    const pickup = await schedulePickup(staffToken, application._id);
    const placement = await request(app)
      .post("/api/foster")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ application: application._id, pet: pet._id.toString(), fosterer: applicantUserId, startDate: "2026-08-23T09:00:00.000Z", trialDurationDays: 30 });
    expect(placement.status).toBe(201);

    const moved = await request(app)
      .put(`/api/adoption-pickups/${pickup._id}`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ scheduledDate: "2026-08-30T09:00:00.000Z" });
    expect(moved.status).toBe(200);

    const stored = await Foster.findById(placement.body.data._id);
    expect(stored.startDate.toISOString()).toBe("2026-08-30T09:00:00.000Z");
    expect(stored.expectedEndDate.toISOString()).toBe("2026-09-29T09:00:00.000Z");
  });

  it("extends an active foster instead of closing it, capped at 30 extra days", async () => {
    const foster = await Foster.create({
      pet: pet._id,
      fosterer: applicantUserId,
      application: new (require("mongoose").Types.ObjectId)(),
      startDate: new Date("2026-08-23T00:00:00.000Z"),
      expectedEndDate: new Date("2026-09-22T00:00:00.000Z"),
      trialDurationDays: 30,
      weeklyReportsRequired: 5,
      status: "active",
    });
    await Pet.findByIdAndUpdate(pet._id, { status: "Foster" });

    const extended = await request(app)
      .put(`/api/foster/${foster._id}/end`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ outcome: "EXTENDED", extensionDays: 14 });
    expect(extended.status).toBe(200);
    const stored = await Foster.findById(foster._id);
    expect(stored.status).toBe("active");
    expect(stored.extendedDays).toBe(14);
    expect(stored.trialDurationDays).toBe(44);
    expect(stored.weeklyReportsRequired).toBe(7);
    expect(stored.expectedEndDate.toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect((await Pet.findById(pet._id)).status).toBe("Foster");

    const tooMuch = await request(app)
      .put(`/api/foster/${foster._id}/end`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ outcome: "EXTENDED", extensionDays: 20 });
    expect(tooMuch.status).toBe(409);
  });

  it("keeps a placement's reports private to the fosterer and staff", async () => {
    const application = await createApprovedFosterApplication(applicantToken, staffToken, pet);
    await schedulePickup(staffToken, application._id);
    const placement = await request(app)
      .post("/api/foster")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ application: application._id, pet: pet._id.toString(), fosterer: applicantUserId, startDate: "2026-08-23T09:00:00.000Z", trialDurationDays: 30 });
    expect(placement.status).toBe(201);
    const id = placement.body.data._id;

    const stranger = await registerAndLogin("foster-stranger@example.com");
    const read = await request(app).get(`/api/foster/${id}/reports`).set("Authorization", `Bearer ${stranger.token}`);
    expect(read.status).toBe(403);
    const write = await request(app).post(`/api/foster/${id}/reports`).set("Authorization", `Bearer ${stranger.token}`).send({ weekNumber: 1 });
    expect(write.status).toBe(403);
    const detail = await request(app).get(`/api/foster/${id}`).set("Authorization", `Bearer ${stranger.token}`);
    expect(detail.status).toBe(403);

    const own = await request(app).get(`/api/foster/${id}/reports`).set("Authorization", `Bearer ${applicantToken}`);
    expect(own.status).toBe(200);
    const staff = await request(app).get(`/api/foster/${id}/reports`).set("Authorization", `Bearer ${staffToken}`);
    expect(staff.status).toBe(200);
  });

});
