const AdoptionPickup = require("../models/AdoptionPickup");
const Application = require("../models/Application");
const { advanceApplicationStage } = require("./applicationController");
const { notifyOnce } = require("../utils/notificationHelper");

const STAFF_ROLES = ["staff", "admin", "super_admin"];
const DEFAULT_LOCATION = "the shelter";

function fail(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function describePickup(pickup) {
  const when = new Date(pickup.scheduledDate).toLocaleString();
  const where = pickup.method === "Home delivery" ? `delivered to ${pickup.location}` : `picked up at ${pickup.location || DEFAULT_LOCATION}`;
  return `${when}, ${where}`;
}

async function myPickups(req, res, next) {
  try {
    const data = await AdoptionPickup.find({ applicant: req.user._id }).populate("pet").sort({ scheduledDate: -1 });
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const data = await AdoptionPickup.find().populate("applicant pet handledBy").sort({ scheduledDate: -1 });
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const pickup = await AdoptionPickup.findById(req.params.id).populate("applicant pet handledBy");
    if (!pickup) return res.status(404).json({ success: false, message: "Pickup not found" });
    const isStaff = STAFF_ROLES.includes(req.user.role);
    if (!isStaff && String(pickup.applicant._id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to view this pickup" });
    }
    return res.json({ success: true, data: pickup });
  } catch (err) {
    next(err);
  }
}

// POST /api/adoption-pickups — schedule the handover of an approved adoption.
async function create(req, res, next) {
  try {
    const application = await Application.findById(req.body.application);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    if (application.type !== "adoption") throw fail(409, "Pickup scheduling is only for adoption applications");
    if (application.status !== "approved") throw fail(409, "Only an approved application can be scheduled for pickup");
    if (!["approved", "adoption_scheduled"].includes(application.stage)) {
      throw fail(409, "This application is not waiting for a pickup");
    }
    const active = await AdoptionPickup.exists({ application: application._id, status: "scheduled" });
    if (active) throw fail(409, "This application already has a scheduled pickup. Reschedule or cancel it instead.");

    const pickup = await AdoptionPickup.create({
      ...req.body,
      location: req.body.method === "Shelter pickup" ? req.body.location || DEFAULT_LOCATION : req.body.location,
      applicant: application.applicant,
      pet: application.pet,
      handledBy: req.user._id,
    });

    // First pickup moves the pipeline forward; a rescheduled one after a cancellation stays put.
    if (application.stage === "approved") {
      await advanceApplicationStage(application, "adoption_scheduled", req.user._id, `Pickup scheduled for ${new Date(pickup.scheduledDate).toLocaleString()}`);
    }

    await notifyOnce({
      recipient: pickup.applicant,
      type: "ADOPTION_PICKUP_SCHEDULED",
      title: "Pet pickup scheduled",
      message: `Your pet pickup is scheduled: ${describePickup(pickup)}.`,
      refModel: "AdoptionPickup",
      refId: pickup._id,
      dedupeKey: `adoption-pickup-scheduled:${pickup._id}:${new Date(pickup.scheduledDate).getTime()}`,
    });
    return res.status(201).json({ success: true, data: pickup });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
}

// PUT /api/adoption-pickups/:id — reschedule or edit details.
async function update(req, res, next) {
  try {
    const pickup = await AdoptionPickup.findById(req.params.id);
    if (!pickup) return res.status(404).json({ success: false, message: "Pickup not found" });
    if (pickup.status !== "scheduled") throw fail(409, "Only a scheduled pickup can be changed");

    const next_ = { ...req.body };
    const method = next_.method || pickup.method;
    if (method === "Home delivery" && !(next_.location || pickup.location)) throw fail(400, "A delivery address is required for home delivery");
    if (method === "Shelter pickup" && !next_.location && pickup.method === "Home delivery") next_.location = DEFAULT_LOCATION;

    pickup.set(next_);
    await pickup.save();

    await notifyOnce({
      recipient: pickup.applicant,
      type: "ADOPTION_PICKUP_RESCHEDULED",
      title: "Pet pickup updated",
      message: `Your pet pickup has been updated: ${describePickup(pickup)}.`,
      refModel: "AdoptionPickup",
      refId: pickup._id,
      dedupeKey: `adoption-pickup-updated:${pickup._id}:${Date.now()}`,
    });
    return res.json({ success: true, data: pickup });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
}

// PUT /api/adoption-pickups/:id/complete — handover done; the adoption is finalized.
async function complete(req, res, next) {
  try {
    const pickup = await AdoptionPickup.findById(req.params.id);
    if (!pickup) return res.status(404).json({ success: false, message: "Pickup not found" });
    if (pickup.status !== "scheduled") throw fail(409, "Only a scheduled pickup can be completed");

    const application = await Application.findById(pickup.application);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    if (application.stage !== "adoption_scheduled") throw fail(409, "Application is not at the adoption scheduled stage");

    // Advance first: if the stage rules reject it, the pickup stays scheduled.
    await advanceApplicationStage(application, "completed", req.user._id, "Pet handed over to adopter");

    pickup.status = "completed";
    pickup.completedAt = new Date();
    pickup.handledBy = req.user._id;
    if (req.body.notes) pickup.notes = req.body.notes;
    await pickup.save();

    await notifyOnce({
      recipient: pickup.applicant,
      type: "ADOPTION_PICKUP_COMPLETED",
      title: "Adoption complete",
      message: "Your pet has been handed over. Congratulations on your new family member! Tell us how it went — open your application to leave a review.",
      refModel: "AdoptionPickup",
      refId: pickup._id,
    });
    return res.json({ success: true, data: pickup });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
}

// PUT /api/adoption-pickups/:id/cancel — the application stays at "adoption scheduled" so a new pickup can be booked.
async function cancel(req, res, next) {
  try {
    const pickup = await AdoptionPickup.findById(req.params.id);
    if (!pickup) return res.status(404).json({ success: false, message: "Pickup not found" });
    if (pickup.status !== "scheduled") throw fail(409, "Only a scheduled pickup can be cancelled");

    pickup.status = "cancelled";
    pickup.cancelReason = req.body.cancelReason;
    await pickup.save();

    await notifyOnce({
      recipient: pickup.applicant,
      type: "ADOPTION_PICKUP_CANCELLED",
      title: "Pet pickup cancelled",
      message: pickup.cancelReason || "Your pet pickup was cancelled. We will contact you to arrange a new time.",
      refModel: "AdoptionPickup",
      refId: pickup._id,
    });
    return res.json({ success: true, data: pickup });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
}

// PUT /api/adoption-pickups/:id/no-show — adopter did not show; a new pickup can be booked.
async function noShow(req, res, next) {
  try {
    const pickup = await AdoptionPickup.findById(req.params.id);
    if (!pickup) return res.status(404).json({ success: false, message: "Pickup not found" });
    if (pickup.status !== "scheduled") throw fail(409, "Only a scheduled pickup can be marked as a no-show");
    pickup.status = "no-show";
    await pickup.save();

    await notifyOnce({
      recipient: pickup.applicant,
      type: "ADOPTION_PICKUP_CANCELLED",
      title: "Pet pickup missed",
      message: "You missed your scheduled pet pickup. Please contact the shelter to arrange a new time.",
      refModel: "AdoptionPickup",
      refId: pickup._id,
      dedupeKey: `adoption-pickup-noshow:${pickup._id}`,
    });
    return res.json({ success: true, data: pickup });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
}

module.exports = { myPickups, list, getOne, create, update, complete, cancel, noShow };
