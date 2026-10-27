const mongoose = require("mongoose");
const Interview = require("../../src/models/Interview");
const AdoptionPickup = require("../../src/models/AdoptionPickup");
const Notification = require("../../src/models/Notification");
const { runAdoptionAppointmentReminders } = require("../../src/jobs/reminderJobs");

describe("runAdoptionAppointmentReminders", () => {
  const id = () => new mongoose.Types.ObjectId();

  function atLocalHour(dayOffset, hour) {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d;
  }

  it("reminds adopters the day before, once, and skips other days and other statuses", async () => {
    const applicant = id();
    const tomorrow = await Interview.create({ application: id(), applicant, pet: id(), scheduledDate: atLocalHour(1, 14), method: "In-person" });
    await Interview.create({ application: id(), applicant, pet: id(), scheduledDate: atLocalHour(3, 14), method: "In-person" });
    await Interview.create({ application: id(), applicant, pet: id(), scheduledDate: atLocalHour(1, 15), method: "In-person", status: "cancelled" });
    await AdoptionPickup.create({ application: id(), applicant, pet: id(), scheduledDate: atLocalHour(1, 9), method: "Shelter pickup", location: "the shelter" });

    const first = await runAdoptionAppointmentReminders();
    expect(first.itemsProcessed).toBe(2);
    expect(await Notification.countDocuments({ recipient: applicant, type: "PIPELINE_REMINDER" })).toBe(2);
    expect(await Notification.countDocuments({ recipient: applicant, refId: tomorrow._id, type: "PIPELINE_REMINDER" })).toBe(1);

    // Running again the same day must not duplicate reminders.
    await runAdoptionAppointmentReminders();
    expect(await Notification.countDocuments({ recipient: applicant, type: "PIPELINE_REMINDER" })).toBe(2);
  });
});
