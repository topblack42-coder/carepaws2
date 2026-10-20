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

async function advanceToRiskAssessment(appId, staffToken) {
  for (const stage of ["document_review", "interview", "home_visit", "risk_assessment"]) {
    const res = await request(app)
      .put(`/api/applications/${appId}/stage`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ stage });
    expect(res.status).toBe(200);
  }
}

describe("Application pipeline: submit -> stage transitions -> approve/reject", () => {
  let applicantToken, staffToken, applicantUserId, pet;

  beforeEach(async () => {
    const applicant = await registerAndLogin("applicant@example.com", "user");
    const staff = await registerAndLogin("staff@example.com", "staff");
    applicantToken = applicant.token;
    applicantUserId = applicant.user.id;
    staffToken = staff.token;

    pet = await Pet.create({ name: "Bantay", species: "Dog", status: "Available" });
  });

  it("submits an application and moves the pet to Pending", async () => {
    const res = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.stage).toBe("submitted");
    expect(res.body.data.stageHistory).toHaveLength(1);

    const updatedPet = await Pet.findById(pet._id);
    expect(updatedPet.status).toBe("Pending");
  });

  it("rejects a second application for a pet that's no longer Available", async () => {
    await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });

    const second = await registerAndLogin("second@example.com", "user");
    const res = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${second.token}`)
      .send({ pet: pet._id.toString(), phone: "0917111111", address: "456 Side St" });

    expect(res.status).toBe(409);
  });

  it("uses type-neutral wording when a pet already has an active application", async () => {
    await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });
    // Force the pet back to Available so the active-application check (not the availability check) is what rejects.
    await Pet.updateOne({ _id: pet._id }, { status: "Available" });

    const second = await registerAndLogin("third@example.com", "user");
    const res = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${second.token}`)
      .send({ pet: pet._id.toString(), phone: "0917111111", address: "456 Side St", type: "foster", fosterPeriod: "4 weeks" });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This pet already has an active application");
  });

  it("staff can move an application through pipeline stages, recording stageHistory", async () => {
    const submitRes = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });

    const appId = submitRes.body.data._id;

    const stages = ["document_review", "interview", "home_visit", "risk_assessment", "approved"];
    for (const stage of stages) {
      const res = await request(app)
        .put(`/api/applications/${appId}/stage`)
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ stage, note: `moved to ${stage}` });
      expect(res.status).toBe(200);
      expect(res.body.data.stage).toBe(stage);
    }

    const final = await Application.findById(appId);
    // 1 initial "submitted" entry from creation + 5 explicit transitions
    expect(final.stageHistory).toHaveLength(6);
  });

  it("does not allow skipping required pipeline stages", async () => {
    const submitRes = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });

    const res = await request(app)
      .put(`/api/applications/${submitRes.body.data._id}/stage`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ stage: "home_visit" });

    expect(res.status).toBe(409);
    expect((await Application.findById(submitRes.body.data._id)).stage).toBe("submitted");
  });

  it("approving an application marks the pet Adopted; rejecting frees it back to Available", async () => {
    const submitRes = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });

    const appId = submitRes.body.data._id;
    await advanceToRiskAssessment(appId, staffToken);

    const approveRes = await request(app)
      .put(`/api/applications/${appId}/status`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ status: "approved" });

    expect(approveRes.status).toBe(200);
    expect((await Pet.findById(pet._id)).status).toBe("Adopted");

    // A separate pet/application to exercise the rejection path.
    const pet2 = await Pet.create({ name: "Luna", species: "Cat", status: "Available" });
    const submitRes2 = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet2._id.toString(), phone: "0917000000", address: "123 Main St" });

    await advanceToRiskAssessment(submitRes2.body.data._id, staffToken);
    const rejectRes = await request(app)
      .put(`/api/applications/${submitRes2.body.data._id}/status`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ status: "rejected" });

    expect(rejectRes.status).toBe(200);
    expect((await Pet.findById(pet2._id)).status).toBe("Available");
  });

  it("approving an application sets Pet.owner to the applicant, and distinguishes foster from adoption", async () => {
    const submitRes = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });

    await request(app)
      .put(`/api/applications/${submitRes.body.data._id}/status`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ status: "approved" });

    const adoptedPet = await Pet.findById(pet._id);
    expect(adoptedPet.status).toBe("Adopted");
    expect(adoptedPet.owner?.toString()).toBe(applicantUserId);

    // A foster application should mark the pet Foster (not Adopted) and still assign the owner.
    const pet2 = await Pet.create({ name: "Ginger", species: "Cat", status: "Available" });
    const fosterSubmit = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet2._id.toString(), phone: "0917000000", address: "123 Main St", type: "foster" });

    await advanceToRiskAssessment(fosterSubmit.body.data._id, staffToken);
    await request(app)
      .put(`/api/applications/${fosterSubmit.body.data._id}/status`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ status: "approved" });

    const fosteredPet = await Pet.findById(pet2._id);
    expect(fosteredPet.status).toBe("Foster");
    expect(fosteredPet.owner?.toString()).toBe(applicantUserId);
  });

  it("does not allow an approved application to be reopened", async () => {
    const submitRes = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });

    const appId = submitRes.body.data._id;
    await advanceToRiskAssessment(appId, staffToken);
    await request(app)
      .put(`/api/applications/${appId}/status`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ status: "approved" });

    const reopen = await request(app)
      .put(`/api/applications/${appId}/status`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ status: "pending" });

    expect(reopen.status).toBe(409);
    expect((await Application.findById(appId)).status).toBe("approved");
    expect((await Pet.findById(pet._id)).status).toBe("Adopted");
  });

  it("a non-owner, non-staff user cannot view someone else's application", async () => {
    const submitRes = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });

    const stranger = await registerAndLogin("stranger@example.com", "user");
    const res = await request(app)
      .get(`/api/applications/${submitRes.body.data._id}`)
      .set("Authorization", `Bearer ${stranger.token}`);

    expect(res.status).toBe(403);
  });

  it("internal notes are visible to staff but stripped from the applicant's view", async () => {
    const submitRes = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });

    const appId = submitRes.body.data._id;

    await request(app)
      .post(`/api/applications/${appId}/notes`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ text: "Applicant seems well-prepared." });

    const asStaff = await request(app).get(`/api/applications/${appId}`).set("Authorization", `Bearer ${staffToken}`);
    expect(asStaff.body.data.internalNotes).toBeDefined();
    expect(asStaff.body.data.internalNotes.length).toBe(1);

    const asApplicant = await request(app).get(`/api/applications/${appId}`).set("Authorization", `Bearer ${applicantToken}`);
    expect(asApplicant.body.data.internalNotes).toBeUndefined();
  });

  it("a note's author is populated with a display name, both immediately and on reload", async () => {
    const submitRes = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });

    const appId = submitRes.body.data._id;

    const noteRes = await request(app)
      .post(`/api/applications/${appId}/notes`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ text: "Applicant seems well-prepared." });

    expect(noteRes.status).toBe(201);
    expect(noteRes.body.data[0].author.displayName).toBe("Test staff");

    const reloaded = await request(app).get(`/api/applications/${appId}`).set("Authorization", `Bearer ${staffToken}`);
    expect(reloaded.body.data.internalNotes[0].author.displayName).toBe("Test staff");
  });

  it("staff recording a walk-in application can specify who the applicant actually is", async () => {
    const walkIn = await registerAndLogin("walkin@example.com", "user");

    const res = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ pet: pet._id.toString(), applicant: walkIn.user.id, phone: "0917000000", address: "123 Main St" });

    expect(res.status).toBe(201);
    // Regression test: this used to always be the staff member's own id.
    expect(res.body.data.applicant._id).toBe(walkIn.user.id);

    const stored = await Application.findById(res.body.data._id);
    expect(stored.applicant.toString()).toBe(walkIn.user.id);
  });

  it("a non-staff applicant cannot use the applicant field to submit on someone else's behalf", async () => {
    const other = await registerAndLogin("other@example.com", "user");

    const res = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), applicant: other.user.id, phone: "0917000000", address: "123 Main St" });

    expect(res.status).toBe(201);
    expect(res.body.data.applicant._id).toBe(applicantUserId);
  });

  it("returns 404 when staff specifies an applicant id that doesn't exist", async () => {
    const res = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ pet: pet._id.toString(), applicant: "507f1f77bcf86cd799439011", phone: "0917000000", address: "123 Main St" });

    expect(res.status).toBe(404);
  });

  it("keeps the pet and applicant populated in the response after a stage or status change, not just on first load", async () => {
    const submitRes = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });

    const appId = submitRes.body.data._id;

    const stageRes = await request(app)
      .put(`/api/applications/${appId}/stage`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ stage: "document_review" });
    expect(stageRes.body.data.pet.name).toBe("Bantay");
    expect(stageRes.body.data.applicant.displayName).toBe("Test user");

    await request(app)
      .put(`/api/applications/${appId}/stage`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ stage: "interview" });
    await request(app)
      .put(`/api/applications/${appId}/stage`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ stage: "home_visit" });
    await request(app)
      .put(`/api/applications/${appId}/stage`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ stage: "risk_assessment" });

    const statusRes = await request(app)
      .put(`/api/applications/${appId}/status`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ status: "approved" });
    expect(statusRes.body.data.pet.name).toBe("Bantay");
    expect(statusRes.body.data.applicant.displayName).toBe("Test user");
  });

  it("deleting a pending application releases the pet back to Available", async () => {
    const submitRes = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${applicantToken}`)
      .send({ pet: pet._id.toString(), phone: "0917000000", address: "123 Main St" });

    expect((await Pet.findById(pet._id)).status).toBe("Pending");

    const del = await request(app)
      .delete(`/api/applications/${submitRes.body.data._id}`)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(del.status).toBe(200);
    expect((await Pet.findById(pet._id)).status).toBe("Available");
    expect(await Application.findById(submitRes.body.data._id)).toBeNull();
  });
});
