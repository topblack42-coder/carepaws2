// Mocked-DB test for the daily end-date alert job: stages, recipients and idempotence.
jest.mock("../../src/models/Foster", () => ({ Foster: { find: jest.fn() }, WeeklyFosterReport: {}, getFosterReportDueDate: jest.fn() }));
jest.mock("../../src/models/User", () => ({ find: jest.fn() }));
jest.mock("../../src/models/ScheduledJobLog", () => ({ create: jest.fn().mockResolvedValue({}) }));
jest.mock("../../src/models/MedicalRecord", () => ({ Vaccination: {} }));
jest.mock("../../src/models/UserDocument", () => ({}));
jest.mock("../../src/models/Application", () => ({}));
jest.mock("../../src/models/MonitoringReport", () => ({}));
jest.mock("../../src/models/Notification", () => ({}));
jest.mock("../../src/utils/monitoringSchedule", () => ({ MONITORING_PERIODS: [], getMonitoringSchedule: jest.fn() }));
jest.mock("../../src/utils/notificationHelper", () => ({ notifyOnce: jest.fn().mockResolvedValue({}), notify: jest.fn() }));

const { Foster } = require("../../src/models/Foster");
const User = require("../../src/models/User");
const ScheduledJobLog = require("../../src/models/ScheduledJobLog");
const { notifyOnce } = require("../../src/utils/notificationHelper");
const { runFosterEndDateAlerts } = require("../../src/jobs/reminderJobs");

const DAY = 24 * 60 * 60 * 1000;

function foster(endOffsetDays, extra = {}) {
  return {
    _id: "f1",
    expectedEndDate: new Date(Date.now() + endOffsetDays * DAY),
    pet: { name: "Bantay" },
    fosterer: { _id: "u1", displayName: "Maria", phone: "0917" },
    emergencyContact: { name: "Ana", phone: "0999" },
    endAlertStage: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...extra,
  };
}
function setup(fosters) {
  const chain = { populate: () => chain, then: (resolve, reject) => Promise.resolve(fosters).then(resolve, reject) };
  Foster.find.mockReturnValue(chain);
  User.find.mockImplementation((query) => ({
    select: async () => (query.role.$in.length === 3 ? [{ _id: "staff1" }, { _id: "admin1" }, { _id: "root1" }] : [{ _id: "admin1" }, { _id: "root1" }]),
  }));
}

beforeEach(() => jest.clearAllMocks());

it("warns the fosterer and all staff a few days before the end date", async () => {
  const f = foster(5);
  setup([f]);
  const result = await runFosterEndDateAlerts();
  expect(result).toEqual({ status: "success", itemsProcessed: 4 });
  expect(notifyOnce.mock.calls.map(([n]) => n.type)).toEqual(Array(4).fill("FOSTER_ENDING_SOON"));
  expect(f.endAlertStage).toBe("ending_7d");
  expect(f.save).toHaveBeenCalled();
});

it("does nothing when the end date is far away, or that stage was already sent", async () => {
  setup([foster(20), foster(5, { endAlertStage: "ending_7d" })]);
  await runFosterEndDateAlerts();
  expect(notifyOnce).not.toHaveBeenCalled();
});

it("alerts after the end date, with fosterer and emergency contact details for staff", async () => {
  setup([foster(-1)]);
  await runFosterEndDateAlerts();
  const staffAlert = notifyOnce.mock.calls.map(([n]) => n).find((n) => n.recipient === "staff1");
  expect(staffAlert).toMatchObject({ type: "FOSTER_OVERDUE", title: "Foster placement is overdue" });
  expect(staffAlert.message).toMatch(/0917/);
  expect(staffAlert.message).toMatch(/Ana 0999/);
});

it("escalates to admins only once a placement is 3+ days and 7+ days overdue", async () => {
  const f = foster(-4);
  setup([f]);
  await runFosterEndDateAlerts();
  const recipients = notifyOnce.mock.calls.map(([n]) => n.recipient);
  expect(recipients).toEqual(expect.arrayContaining(["u1", "admin1", "root1"]));
  expect(recipients).not.toContain("staff1");
  expect(notifyOnce.mock.calls.find(([n]) => n.recipient === "admin1")[0].title).toMatch(/ESCALATION: foster overdue 3\+ days/);
  expect(f.endAlertStage).toBe("overdue_3d");

  notifyOnce.mockClear();
  const g = foster(-8, { endAlertStage: "overdue_3d" });
  setup([g]);
  await runFosterEndDateAlerts();
  expect(notifyOnce.mock.calls.find(([n]) => n.recipient === "admin1")[0].title).toMatch(/7\+ days/);
  expect(g.endAlertStage).toBe("overdue_7d");
});

it("keys notifications on the end date so an extension restarts the alerts", async () => {
  const f = foster(-1);
  setup([f]);
  await runFosterEndDateAlerts();
  const keyBefore = notifyOnce.mock.calls[0][0].dedupeKey;
  notifyOnce.mockClear();
  f.expectedEndDate = new Date(f.expectedEndDate.getTime() + 14 * DAY);
  f.endAlertStage = null;
  await runFosterEndDateAlerts();
  expect(notifyOnce.mock.calls.length).toBe(0); // 13 days away: no stage yet
  f.expectedEndDate = new Date(Date.now() + 2 * DAY);
  await runFosterEndDateAlerts();
  expect(notifyOnce.mock.calls[0][0].dedupeKey).not.toBe(keyBefore);
});

it("logs the run and survives a failure", async () => {
  Foster.find.mockImplementation(() => { throw new Error("db down"); });
  const result = await runFosterEndDateAlerts();
  expect(result.status).toBe("failed");
  expect(ScheduledJobLog.create).toHaveBeenCalledWith(expect.objectContaining({ jobKey: "foster_end_date_alerts", status: "failed", message: "db down" }));
});
