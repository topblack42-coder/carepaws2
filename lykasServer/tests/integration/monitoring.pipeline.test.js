const request = require("supertest");

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
const MonitoringReport = require("../../src/models/MonitoringReport");
const Notification = require("../../src/models/Notification");
const { runMonitoringReportMonitoring } = require("../../src/jobs/reminderJobs");

async function registerAndLogin(email, role = "user") {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ displayName: "Test " + role, email, password: "password123" });

  if (role !== "user") {
    await User.findOneAndUpdate({ email }, { role });
    const loginRes = await request(app).post("/api/auth/login").send({ email, password: "password123" });
    return { token: loginRes.body.data.accessToken, user: loginRes.body.data.user };
  }

  return { token: res.body.data.accessToken, user: res.body.data.user };
}

describe("Post-adoption monitoring pipeline", () => {
  it("creates a completed-adoption schedule, reminds once, accepts a report, and completes it on staff review", async () => {
    const adopter = await registerAndLogin("monitoring-adopter@example.com");
    const staff = await registerAndLogin("monitoring-staff@example.com", "staff");
    const pet = await Pet.create({ name: "Milo", species: "Dog", status: "Adopted", owner: adopter.user.id });
    const completedAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

    const application = await Application.create({
      pet: pet._id,
      applicant: adopter.user.id,
      type: "adoption",
      status: "approved",
      stage: "completed",
      stageHistory: [{ stage: "completed", changedAt: completedAt }],
    });

    await runMonitoringReportMonitoring();

    let schedule = await MonitoringReport.find({ application: application._id }).sort({ monitoringPeriod: 1 });
    expect(schedule).toHaveLength(3);
    expect(schedule[0].application.toString()).toBe(application._id.toString());
    expect(schedule[0].submittedBy.toString()).toBe(adopter.user.id);
    expect(schedule[0].pet.toString()).toBe(pet._id.toString());
    expect(schedule[0].dueDate).toBeInstanceOf(Date);
    expect(schedule[0].reportMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(schedule[0].status).toBe("pending");

    const dueNotificationCount = await Notification.countDocuments({
      recipient: adopter.user.id,
      type: "MONITORING_REPORT_DUE",
    });
    expect(dueNotificationCount).toBe(1);

    const secondRun = await runMonitoringReportMonitoring();
    expect(secondRun.status).toBe("success");
    expect(await Notification.countDocuments({ recipient: adopter.user.id, type: "MONITORING_REPORT_DUE" })).toBe(1);

    const reportRes = await request(app)
      .post("/api/monitoring-reports")
      .set("Authorization", `Bearer ${adopter.token}`)
      .send({
        application: application._id.toString(),
        pet: pet._id.toString(),
        monitoringPeriod: 1,
        overallCondition: "Good",
        diet: "Normal",
      });

    expect(reportRes.status).toBe(201);
    expect(reportRes.body.data.application._id).toBe(application._id.toString());
    expect(reportRes.body.data.pet._id).toBe(pet._id.toString());
    expect(reportRes.body.data.status).toBe("pending");
    expect(reportRes.body.data.submittedAt).toBeTruthy();

    const reviewRes = await request(app)
      .put(`/api/monitoring-reports/${reportRes.body.data._id}/review`)
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ status: "reviewed" });

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.data.status).toBe("reviewed");
    expect(reviewRes.body.data.completedAt).toBeTruthy();

    await runMonitoringReportMonitoring();
    expect(await Notification.countDocuments({
      recipient: adopter.user.id,
      type: "MONITORING_REPORT_DUE",
      refId: reportRes.body.data._id,
    })).toBe(1);
  });

  it("does not create monitoring records for an unfinished adoption or an orphan pet submission", async () => {
    const adopter = await registerAndLogin("unfinished-monitoring@example.com");
    const pet = await Pet.create({ name: "Nala", species: "Cat", status: "Adopted", owner: adopter.user.id });
    const application = await Application.create({
      pet: pet._id,
      applicant: adopter.user.id,
      type: "adoption",
      status: "approved",
      stage: "approved",
      stageHistory: [{ stage: "approved", changedAt: new Date() }],
    });

    await runMonitoringReportMonitoring();
    expect(await MonitoringReport.countDocuments({ application: application._id })).toBe(0);

    const response = await request(app)
      .post("/api/monitoring-reports")
      .set("Authorization", `Bearer ${adopter.token}`)
      .send({ pet: pet._id.toString(), overallCondition: "Good" });

    expect(response.status).toBe(409);
  });
});
