const {
  MIN_EXTENSION_DAYS,
  MAX_EXTENSION_DAYS,
  COMPLETION_OUTCOMES,
  validateExtensionDays,
  evaluateReports,
  endDateAlertStage,
} = require("../../src/utils/fosterRules");

const DAY = 24 * 60 * 60 * 1000;

describe("validateExtensionDays", () => {
  it("accepts 7 to 30 days when nothing was used yet", () => {
    expect(validateExtensionDays(7, 0).ok).toBe(true);
    expect(validateExtensionDays(30, 0).ok).toBe(true);
  });

  it.each([-5, 0, 6, 1.5, "14", null, undefined, NaN])("rejects %p as not a valid extension length", (days) => {
    const result = validateExtensionDays(days, 0);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("enforces the 30-day total including days already used", () => {
    expect(validateExtensionDays(16, 14)).toMatchObject({ ok: true });
    expect(validateExtensionDays(17, 14)).toMatchObject({ ok: false, status: 409 });
    expect(validateExtensionDays(7, 30)).toMatchObject({ ok: false, status: 409 });
  });

  it("exposes the limits and completion outcomes the admin screen relies on", () => {
    expect(MIN_EXTENSION_DAYS).toBe(7);
    expect(MAX_EXTENSION_DAYS).toBe(30);
    expect(COMPLETION_OUTCOMES).toEqual(["ADOPTED", "RETURNED"]);
  });
});

describe("evaluateReports", () => {
  const start = new Date("2026-08-23T00:00:00.000Z");
  const foster = {
    startDate: start,
    expectedEndDate: new Date(start.getTime() + 30 * DAY),
    trialDurationDays: 30,
    weeklyReportsRequired: 5,
  };
  const submitted = (weekNumber, extra = {}) => ({ weekNumber, status: "submitted", reviewedBy: "staff1", ...extra });

  it("treats a placement with every report submitted and reviewed as complete", () => {
    const result = evaluateReports(foster, [1, 2, 3, 4, 5].map((w) => submitted(w)), new Date(start.getTime() + 40 * DAY));
    expect(result).toMatchObject({ submitted: 5, missingWeeks: [], overdueWeeks: [], unreviewedWeeks: [], healthFlags: [] });
  });

  it("separates missing, overdue and unreviewed weeks", () => {
    const now = new Date(start.getTime() + 15 * DAY); // weeks 1 and 2 are due, weeks 3 to 5 are not
    const reports = [submitted(1), submitted(2, { reviewedBy: null })];
    const result = evaluateReports(foster, reports, now);
    expect(result.missingWeeks).toEqual([3, 4, 5]);
    expect(result.overdueWeeks).toEqual([]);
    expect(result.unreviewedWeeks).toEqual([2]);
  });

  it("counts a missing report as overdue once its due date has passed", () => {
    const now = new Date(start.getTime() + 15 * DAY);
    const result = evaluateReports(foster, [submitted(1)], now);
    expect(result.overdueWeeks).toEqual([2]);
  });

  it("does not count an overdue placeholder as submitted", () => {
    const result = evaluateReports(foster, [{ weekNumber: 1, status: "overdue", dueDate: new Date(start.getTime() + 7 * DAY) }], new Date(start.getTime() + 30 * DAY));
    expect(result.submitted).toBe(0);
    expect(result.missingWeeks).toContain(1);
  });

  it("flags reports that describe a possible health problem, because submission alone proves nothing", () => {
    const reports = [
      submitted(1, { overallProgress: "Good" }),
      submitted(2, { overallProgress: "Needs Attention" }),
      submitted(3, { vetVisitRequired: true, healthConcerns: "Limping" }),
    ];
    const result = evaluateReports(foster, reports, new Date(start.getTime() + 40 * DAY));
    expect(result.healthFlags.map((f) => f.weekNumber)).toEqual([2, 3]);
    expect(result.healthFlags[1].reasons).toEqual(expect.arrayContaining(["vet visit requested", "health concerns reported"]));
  });
});

describe("endDateAlertStage", () => {
  const now = new Date("2026-10-01T09:00:00.000Z");
  const endIn = (days) => new Date(now.getTime() + days * DAY);

  it("sends nothing while the end is more than a week away", () => {
    expect(endDateAlertStage(endIn(8), now)).toBeNull();
    expect(endDateAlertStage(null, now)).toBeNull();
  });

  it("warns 7 days and 1 day before the end", () => {
    expect(endDateAlertStage(endIn(7), now).stage).toBe("ending_7d");
    expect(endDateAlertStage(endIn(3), now).stage).toBe("ending_7d");
    expect(endDateAlertStage(endIn(0.5), now).stage).toBe("ending_1d");
  });

  it("alerts after the end date and escalates at 3 and 7 days overdue", () => {
    expect(endDateAlertStage(endIn(-0.5), now)).toMatchObject({ stage: "overdue", escalate: false });
    expect(endDateAlertStage(endIn(-3), now)).toMatchObject({ stage: "overdue_3d", escalate: true });
    expect(endDateAlertStage(endIn(-6.5), now)).toMatchObject({ stage: "overdue_3d" });
    expect(endDateAlertStage(endIn(-7), now)).toMatchObject({ stage: "overdue_7d", escalate: true, daysOverdue: 7 });
  });
});
