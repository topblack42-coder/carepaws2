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

async function makeApplication(applicantId, stage, extra = {}) {
  const pet = await Pet.create({ name: "Felix", species: "Cat", status: "Pending" });
  return Application.create({
    pet: pet._id,
    applicant: applicantId,
    phone: "09521587412",
    address: "Home",
    status: "pending",
    stage,
    ...extra,
  });
}

const SCORES = {
  housingStability: 4,
  financialReadiness: 4,
  petExperience: 4,
  lifestyleMatch: 4,
  familyCommitment: 4,
  knowledgeOfPet: 4,
};

// Regression coverage for the "Whesley — Felix" bug: the admin Application
// Details page showed Home visit as the current pipeline stage, but
// "Schedule home visit" rejected it with "Application must be at the home
// visit stage before a visit can be scheduled". Root cause: homeVisitController
// .create() (and the identical pattern in interviewController.create() and
// riskAssessmentController.create()) fetched the application with
// `.select("applicant pet status type")`, which silently dropped `stage`.
// `application.stage` was therefore always `undefined`, so `undefined !==
// "home_visit"` was always true and the guard rejected every application
// regardless of its real stage — while the admin UI (which reads the
// un-projected GET /api/applications/:id response) displayed the true stage
// correctly. The two representations were never actually out of sync in the
// database; only this one query projection failed to read the value it
// validated against.
describe("Regression: admin pipeline stage must match the stage scheduling validation reads (screenshot bug)", () => {
  let staff, applicant;

  beforeEach(async () => {
    staff = await registerAndLogin("stageconsistency-staff@example.com", "staff");
    applicant = await registerAndLogin("stageconsistency-applicant@example.com");
  });

  it("home visit scheduling succeeds for an application genuinely at the home_visit stage — the exact reported bug", async () => {
    const application = await makeApplication(applicant.user.id, "home_visit");

    // This is exactly what the admin Application Details page reads to
    // render the Pipeline component — confirm it already reports "home_visit"
    // before we even attempt to schedule anything.
    const detail = await request(app)
      .get(`/api/applications/${application._id}`)
      .set("Authorization", `Bearer ${staff.token}`);
    expect(detail.body.data.stage).toBe("home_visit");

    // Before the fix this always returned 409 "Application must be at the
    // home visit stage before a visit can be scheduled" for every
    // application, regardless of its actual stage.
    const scheduleRes = await request(app)
      .post("/api/home-visits")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({
        application: application._id.toString(),
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        address: "Nonose",
      });

    expect(scheduleRes.status).toBe(201);
    expect(scheduleRes.body.data.application).toBe(application._id.toString());
  });

  it.each([
    ["submitted"],
    ["document_review"],
    ["interview"],
    ["risk_assessment"],
    ["approved"],
    ["adoption_scheduled"],
    ["completed"],
  ])("rejects home visit scheduling when the application stage is '%s'", async (stage) => {
    const needsApprovedStatus = ["approved", "adoption_scheduled", "completed"].includes(stage);
    const application = await makeApplication(applicant.user.id, stage, needsApprovedStatus ? { status: "approved" } : {});

    const res = await request(app)
      .post("/api/home-visits")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ application: application._id.toString(), scheduledDate: new Date(Date.now() + 86400000).toISOString() });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Application must be at the home visit stage before a visit can be scheduled");
  });

  it("rejects home visit scheduling for a rejected application with its own message", async () => {
    const application = await makeApplication(applicant.user.id, "risk_assessment", { status: "rejected" });

    const res = await request(app)
      .post("/api/home-visits")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ application: application._id.toString(), scheduledDate: new Date(Date.now() + 86400000).toISOString() });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Cannot schedule a home visit for a rejected application");
  });

  it("a non-staff applicant cannot call the staff-only home visit scheduling endpoint", async () => {
    const application = await makeApplication(applicant.user.id, "home_visit");

    const res = await request(app)
      .post("/api/home-visits")
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ application: application._id.toString(), scheduledDate: new Date(Date.now() + 86400000).toISOString() });

    expect(res.status).toBe(403);
  });

  // Sibling bug #1: interviewController.create() had the identical
  // `.select("applicant pet status type")` gap, so no interview could ever
  // be scheduled either.
  it("interview scheduling succeeds for an application genuinely at the document_review stage (sibling bug)", async () => {
    const application = await makeApplication(applicant.user.id, "document_review");
    await UserDocument.create({
      user: applicant.user.id,
      application: application._id,
      type: "government_id",
      fileUrl: "https://example.com/doc.jpg",
      status: "verified",
    });

    const res = await request(app)
      .post("/api/interviews")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({
        application: application._id.toString(),
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        method: "In-person",
      });

    expect(res.status).toBe(201);
  });

  it("rejects interview scheduling when the application hasn't reached document_review yet (sibling bug)", async () => {
    const application = await makeApplication(applicant.user.id, "submitted");

    const res = await request(app)
      .post("/api/interviews")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({
        application: application._id.toString(),
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        method: "In-person",
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Application must be in document review before an interview can be scheduled");
  });

  // Sibling bug #2: riskAssessmentController.create() had the same gap.
  it("risk assessment creation succeeds for an application genuinely at the risk_assessment stage (sibling bug)", async () => {
    const application = await makeApplication(applicant.user.id, "risk_assessment");

    const res = await request(app)
      .post("/api/risk-assessments")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ application: application._id.toString(), scores: SCORES });

    expect(res.status).toBe(201);
  });

  it("rejects risk assessment creation when the application hasn't reached risk_assessment yet (sibling bug)", async () => {
    const application = await makeApplication(applicant.user.id, "home_visit");

    const res = await request(app)
      .post("/api/risk-assessments")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ application: application._id.toString(), scores: SCORES });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Application must reach the risk assessment stage before it can be assessed");
  });

  // End-to-end sanity check that the real progression (as driven by the
  // staff-only stage endpoint, mirroring application.pipeline.test.js) still
  // lets a home visit be scheduled once every prior stage is genuinely
  // complete — i.e. the fix didn't loosen validation, it corrected it.
  it("interview → home visit progression works end-to-end through the actual API", async () => {
    const submitRes = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ pet: (await Pet.create({ name: "Bantay", species: "Dog", status: "Available" }))._id.toString(), phone: "0917000000", address: "123 Main St" });
    const appId = submitRes.body.data._id;

    await request(app).put(`/api/applications/${appId}/stage`).set("Authorization", `Bearer ${staff.token}`).send({ stage: "document_review" });

    await UserDocument.create({
      user: applicant.user.id,
      application: appId,
      type: "government_id",
      fileUrl: "https://example.com/doc.jpg",
      status: "verified",
    });

    const interviewRes = await request(app)
      .post("/api/interviews")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ application: appId, scheduledDate: new Date(Date.now() + 86400000).toISOString(), method: "In-person" });
    expect(interviewRes.status).toBe(201);

    const completeRes = await request(app)
      .put(`/api/interviews/${interviewRes.body.data._id}/complete`)
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ result: "passed" });
    expect(completeRes.status).toBe(200);
    expect((await Application.findById(appId)).stage).toBe("home_visit");

    const homeVisitRes = await request(app)
      .post("/api/home-visits")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ application: appId, scheduledDate: new Date(Date.now() + 2 * 86400000).toISOString() });
    expect(homeVisitRes.status).toBe(201);
  });
});
