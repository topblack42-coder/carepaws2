// Mocked-DB tests for the foster completion/extension rules: they call the real
// controller handlers, so no MongoDB is needed.
jest.mock("../../src/models/Foster", () => {
  const actual = jest.requireActual("../../src/models/Foster");
  return {
    getFosterReportDueDate: actual.getFosterReportDueDate,
    Foster: { findById: jest.fn() },
    WeeklyFosterReport: { find: jest.fn() },
  };
});
jest.mock("../../src/models/Pet", () => ({ findByIdAndUpdate: jest.fn().mockResolvedValue({}), findById: jest.fn() }));
jest.mock("../../src/models/User", () => ({ find: jest.fn() }));
jest.mock("../../src/utils/notificationHelper", () => ({ notifyOnce: jest.fn().mockResolvedValue({}), notify: jest.fn() }));

const { Foster, WeeklyFosterReport } = require("../../src/models/Foster");
const Pet = require("../../src/models/Pet");
const User = require("../../src/models/User");
const { notifyOnce } = require("../../src/utils/notificationHelper");
const controller = require("../../src/controllers/fosterController");

const DAY = 24 * 60 * 60 * 1000;
const start = new Date(Date.now() - 60 * DAY); // an old placement: all 5 weekly reports are due
const FOSTERER = "64b000000000000000000010";

function makeFoster(extra = {}) {
  return {
    _id: "f1",
    pet: "p1",
    fosterer: FOSTERER,
    application: "a1",
    startDate: start,
    expectedEndDate: new Date(start.getTime() + 30 * DAY),
    trialDurationDays: 30,
    extendedDays: 0,
    weeklyReportsRequired: 5,
    status: "active",
    extensions: [],
    save: jest.fn().mockResolvedValue(undefined),
    ...extra,
  };
}
// findById(...) can be awaited directly or chained with populate().
function found(doc) {
  const chain = { populate: () => chain, then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject) };
  Foster.findById.mockReturnValue(chain);
}
const goodReport = (weekNumber, extra = {}) => ({ weekNumber, status: "submitted", reviewedBy: "s1", ...extra });
const allReports = (extra) => [1, 2, 3, 4, 5].map((w) => goodReport(w, extra));

function run(handler, { params = { id: "f1" }, body = {}, user = { _id: "staff1", role: "staff" } } = {}) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const next = jest.fn((err) => { throw err; });
  return handler({ params, body, user }, res, next).then(() => res);
}

const healthCheck = { notes: "Checked in person, healthy and eating well.", vetVerified: false };

beforeEach(() => {
  jest.clearAllMocks();
  User.find.mockReturnValue({ select: async () => [{ _id: "s1" }, { _id: "s2" }] });
});

describe("PUT /foster/:id/end", () => {
  it.each(["EXTENDED", "BOGUS", undefined, "adopted"])("refuses outcome %p and leaves the placement and pet untouched", async (outcome) => {
    const foster = makeFoster();
    found(foster);
    const res = await run(controller.end, { body: { outcome, finalHealthCheck: healthCheck } });
    expect(res.statusCode).toBe(400);
    expect(foster.save).not.toHaveBeenCalled();
    expect(Pet.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("blocks completion while reports are missing and no exception is given", async () => {
    const foster = makeFoster();
    found(foster);
    WeeklyFosterReport.find.mockResolvedValue([goodReport(1), goodReport(2)]);
    const res = await run(controller.end, { body: { outcome: "RETURNED", finalHealthCheck: healthCheck } });
    expect(res.statusCode).toBe(409);
    expect(res.body.data.missingWeeks).toEqual([3, 4, 5]);
    expect(foster.status).toBe("active");
    expect(Pet.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("blocks completion while reports are unreviewed", async () => {
    found(makeFoster());
    WeeklyFosterReport.find.mockResolvedValue([1, 2, 3, 4, 5].map((w) => goodReport(w, { reviewedBy: w === 4 ? null : "s1" })));
    const res = await run(controller.end, { body: { outcome: "ADOPTED", finalHealthCheck: healthCheck } });
    expect(res.statusCode).toBe(409);
    expect(res.body.data.unreviewedWeeks).toEqual([4]);
  });

  it("does not let plain staff use the exception, but lets an admin record one", async () => {
    const exception = { reason: "Fosterer's phone was lost; reports were verified by phone." };
    found(makeFoster());
    WeeklyFosterReport.find.mockResolvedValue([goodReport(1)]);
    const denied = await run(controller.end, { body: { outcome: "RETURNED", finalHealthCheck: healthCheck, completionException: exception } });
    expect(denied.statusCode).toBe(403);

    const foster = makeFoster();
    found(foster);
    const allowed = await run(controller.end, {
      body: { outcome: "RETURNED", finalHealthCheck: healthCheck, completionException: exception },
      user: { _id: "admin1", role: "admin" },
    });
    expect(allowed.statusCode).toBe(200);
    expect(foster.status).toBe("completed");
    expect(foster.completionException).toMatchObject({ reason: exception.reason, by: "admin1", missingWeeks: [2, 3, 4, 5] });
  });

  it("completes a RETURNED placement: the pet goes back to the shelter with no owner or fosterer", async () => {
    const foster = makeFoster();
    found(foster);
    WeeklyFosterReport.find.mockResolvedValue(allReports());
    const res = await run(controller.end, { body: { outcome: "RETURNED", finalHealthCheck: healthCheck } });
    expect(res.statusCode).toBe(200);
    expect(foster).toMatchObject({ status: "completed", outcome: "RETURNED", endedBy: "staff1" });
    expect(foster.finalHealthCheck).toMatchObject({ notes: healthCheck.notes, vetVerified: false, checkedBy: "staff1" });
    expect(Pet.findByIdAndUpdate).toHaveBeenCalledWith("p1", { status: "Available", owner: null, currentFosterer: null });
  });

  it("makes the fosterer the owner only when the outcome is ADOPTED", async () => {
    found(makeFoster());
    WeeklyFosterReport.find.mockResolvedValue(allReports());
    await run(controller.end, { body: { outcome: "ADOPTED", finalHealthCheck: healthCheck } });
    expect(Pet.findByIdAndUpdate).toHaveBeenCalledWith("p1", { status: "Adopted", owner: FOSTERER, currentFosterer: null });
  });

  it("requires a vet check when a report raised a health concern, even though every report is in", async () => {
    const foster = makeFoster();
    found(foster);
    WeeklyFosterReport.find.mockResolvedValue(allReports({ vetVisitRequired: true }));
    const blocked = await run(controller.end, { body: { outcome: "ADOPTED", finalHealthCheck: healthCheck } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.body.data.healthFlags).toHaveLength(5);
    expect(foster.status).toBe("active");

    const ok = await run(controller.end, { body: { outcome: "ADOPTED", finalHealthCheck: { ...healthCheck, vetVerified: true } } });
    expect(ok.statusCode).toBe(200);
  });

  it("requires the staff health check", async () => {
    found(makeFoster());
    WeeklyFosterReport.find.mockResolvedValue(allReports());
    const res = await run(controller.end, { body: { outcome: "RETURNED" } });
    expect(res.statusCode).toBe(400);
  });

  it("waives the report gate for an open emergency return, and records why", async () => {
    const foster = makeFoster({ returnRequest: { urgency: "emergency", reason: "Fosterer in hospital", status: "open" } });
    found(foster);
    WeeklyFosterReport.find.mockResolvedValue([]);
    const res = await run(controller.end, { body: { outcome: "RETURNED", finalHealthCheck: healthCheck } });
    expect(res.statusCode).toBe(200);
    expect(foster.completionException.reason).toMatch(/Emergency return: Fosterer in hospital/);
    expect(foster.returnRequest.status).toBe("resolved");
  });

  it("does not waive the gate for a routine return request", async () => {
    found(makeFoster({ returnRequest: { urgency: "routine", reason: "Moving", status: "open" } }));
    WeeklyFosterReport.find.mockResolvedValue([]);
    const res = await run(controller.end, { body: { outcome: "RETURNED", finalHealthCheck: healthCheck } });
    expect(res.statusCode).toBe(409);
  });
});

describe("PUT /foster/:id/extend", () => {
  const validBody = { extensionDays: 14, reason: "Dog still recovering from surgery.", vetAgreed: true, fostererAgreed: true };

  it.each([-10, 0, 6, 1.5])("rejects %p days without changing the end date", async (extensionDays) => {
    const foster = makeFoster();
    const end = foster.expectedEndDate.getTime();
    found(foster);
    WeeklyFosterReport.find.mockResolvedValue(allReports());
    const res = await run(controller.extend, { body: { ...validBody, extensionDays } });
    expect(res.statusCode).toBe(400);
    expect(foster.expectedEndDate.getTime()).toBe(end);
    expect(foster.save).not.toHaveBeenCalled();
  });

  it("enforces the 30-day total", async () => {
    found(makeFoster({ extendedDays: 20, trialDurationDays: 50, weeklyReportsRequired: 8 }));
    WeeklyFosterReport.find.mockResolvedValue([]);
    const res = await run(controller.extend, { body: { ...validBody, extensionDays: 14 } });
    expect(res.statusCode).toBe(409);
  });

  it("requires the fosterer's agreement", async () => {
    found(makeFoster());
    const res = await run(controller.extend, { body: { ...validBody, fostererAgreed: false } });
    expect(res.statusCode).toBe(409);
  });

  it("needs due reports to be submitted and reviewed first (evidence)", async () => {
    found(makeFoster());
    WeeklyFosterReport.find.mockResolvedValue([goodReport(1), goodReport(2, { reviewedBy: null })]);
    const res = await run(controller.extend, { body: validBody });
    expect(res.statusCode).toBe(409);
    expect(res.body.data.overdueWeeks).toEqual([3, 4, 5]);
    expect(res.body.data.unreviewedWeeks).toEqual([2]);
  });

  it("needs a vet to agree when a report raised a health concern", async () => {
    found(makeFoster());
    WeeklyFosterReport.find.mockResolvedValue(allReports({ overallProgress: "Needs Attention" }));
    const res = await run(controller.extend, { body: { ...validBody, vetAgreed: false } });
    expect(res.statusCode).toBe(409);
  });

  it("keeps the placement active, records who recommended and authorized it, and leaves the pet alone", async () => {
    const foster = makeFoster();
    const oldEnd = foster.expectedEndDate.getTime();
    found(foster);
    WeeklyFosterReport.find.mockResolvedValue(allReports());
    const res = await run(controller.extend, { body: { ...validBody, recommendedBy: "vet1", vetNotes: "Re-check in 2 weeks" } });
    expect(res.statusCode).toBe(200);
    expect(foster.status).toBe("active");
    expect(foster.outcome).toBeUndefined();
    expect(foster.extendedDays).toBe(14);
    expect(foster.trialDurationDays).toBe(44);
    expect(foster.weeklyReportsRequired).toBe(7);
    expect(foster.expectedEndDate.getTime()).toBe(oldEnd + 14 * DAY);
    expect(foster.extensions).toHaveLength(1);
    expect(foster.extensions[0]).toMatchObject({
      days: 14, reason: validBody.reason, recommendedBy: "vet1", authorizedBy: "staff1",
      vetAgreed: true, vetNotes: "Re-check in 2 weeks", fostererAgreed: true,
    });
    expect(Pet.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("defaults the recommender to the staff member and restarts the end-date alerts", async () => {
    const foster = makeFoster({ endAlertStage: "overdue" });
    found(foster);
    WeeklyFosterReport.find.mockResolvedValue(allReports());
    await run(controller.extend, { body: validBody });
    expect(foster.extensions[0].recommendedBy).toBe("staff1");
    expect(foster.endAlertStage).toBeNull();
  });
});

describe("POST /foster/:id/return-request", () => {
  const fosterWithContacts = (extra) => makeFoster({ pet: { name: "Bantay" }, fosterer: { _id: FOSTERER, displayName: "Maria", phone: "0917" }, ...extra });

  it("lets the fosterer open an emergency request and alerts staff", async () => {
    const foster = fosterWithContacts({ emergencyContact: { name: "Ana", phone: "0999" } });
    found(foster);
    const res = await run(controller.requestReturn, { body: { urgency: "emergency", reason: "Hospitalised" }, user: { _id: FOSTERER, role: "user" } });
    expect(res.statusCode).toBe(201);
    expect(foster.returnRequest).toMatchObject({ urgency: "emergency", status: "open", requestedBy: FOSTERER });
    expect(notifyOnce).toHaveBeenCalledTimes(2);
    expect(notifyOnce.mock.calls[0][0]).toMatchObject({ type: "FOSTER_RETURN_REQUEST", title: expect.stringMatching(/EMERGENCY/) });
    expect(notifyOnce.mock.calls[0][0].message).toMatch(/0917/);
    expect(notifyOnce.mock.calls[0][0].message).toMatch(/Ana 0999/);
  });

  it("refuses anyone who is not the fosterer or staff", async () => {
    found(fosterWithContacts());
    const res = await run(controller.requestReturn, { body: { urgency: "routine", reason: "Moving house" }, user: { _id: "someone-else", role: "user" } });
    expect(res.statusCode).toBe(403);
  });

  it("does not open a second request, but allows a routine one to be raised to an emergency", async () => {
    const open = { urgency: "routine", reason: "Moving", status: "open" };
    found(fosterWithContacts({ returnRequest: open }));
    const dup = await run(controller.requestReturn, { body: { urgency: "routine", reason: "Moving again" }, user: { _id: FOSTERER, role: "user" } });
    expect(dup.statusCode).toBe(409);

    const foster = fosterWithContacts({ returnRequest: open });
    found(foster);
    const raised = await run(controller.requestReturn, { body: { urgency: "emergency", reason: "Dog is injured" }, user: { _id: FOSTERER, role: "user" } });
    expect(raised.statusCode).toBe(201);
    expect(foster.returnRequest.urgency).toBe("emergency");
  });

  it("only works for an active placement", async () => {
    found(fosterWithContacts({ status: "completed" }));
    const res = await run(controller.requestReturn, { body: { urgency: "routine", reason: "Moving" }, user: { _id: FOSTERER, role: "user" } });
    expect(res.statusCode).toBe(409);
  });
});

describe("PUT /foster/:id (generic update)", () => {
  it("ignores fields that would bypass the end/extend rules", async () => {
    const foster = makeFoster();
    found(foster);
    const res = await run(controller.update, {
      body: { status: "completed", outcome: "RETURNED", extendedDays: -10, extensions: [{ days: 99 }], notes: "Visited on Friday" },
    });
    expect(res.statusCode).toBe(200);
    expect(foster).toMatchObject({ status: "active", extendedDays: 0, notes: "Visited on Friday" });
    expect(foster.outcome).toBeUndefined();
    expect(foster.extensions).toEqual([]);
  });
});
