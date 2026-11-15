const { Foster, WeeklyFosterReport, getFosterReportDueDate } = require("../models/Foster");
const Pet = require("../models/Pet");
const Application = require("../models/Application");
const AdoptionPickup = require("../models/AdoptionPickup");
const { dayOf } = require("../utils/visitTracker");
const User = require("../models/User");
const { notifyOnce } = require("../utils/notificationHelper");
const { COMPLETION_OUTCOMES, validateExtensionDays, evaluateReports } = require("../utils/fosterRules");

const STAFF_ROLES = ["staff", "admin", "super_admin"];
// Only these roles may let a placement close with reports missing or unreviewed.
const EXCEPTION_ROLES = ["admin", "super_admin"];

// Fields staff may change through the generic update. Status, outcome, extensions and
// report counters are deliberately absent: they change only through end/extend/cancel
// so the rules in those handlers cannot be bypassed.
const UPDATABLE_FIELDS = ["startDate", "expectedEndDate", "trialDurationDays", "fosterAgreementSigned", "pickupNotes", "notes", "staffNotes", "emergencyContact"];

async function notifyStaff(payload) {
  const staff = await User.find({ role: { $in: STAFF_ROLES }, status: "active", isDeleted: { $ne: true } }).select("_id");
  for (const member of staff) {
    await notifyOnce({ ...payload, recipient: member._id, dedupeKey: `${payload.dedupeKey}:${member._id}` });
  }
}

// A foster placement (and its reports) is visible to staff and to the fosterer only.
function canAccessFoster(foster, user) {
  if (STAFF_ROLES.includes(user.role)) return true;
  return String(foster.fosterer?._id ?? foster.fosterer) === String(user._id);
}

// GET /api/foster/reports/pending-review — staff
async function pendingReports(req, res, next) {
  try {
    const reports = await WeeklyFosterReport.find({ status: "submitted", reviewedBy: null }).populate("foster pet fosterer").sort({ reportDate: 1 });
    return res.json({ success: true, data: reports });
  } catch (err) {
    next(err);
  }
}

// PUT /api/foster/reports/:reportId/review — staff
async function reviewReport(req, res, next) {
  try {
    const report = await WeeklyFosterReport.findById(req.params.reportId);
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
    if (report.status !== "submitted") {
      return res.status(409).json({ success: false, message: "Only submitted foster reports can be reviewed" });
    }

    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();
    report.adminNotes = typeof req.body.adminNotes === "string" ? req.body.adminNotes.trim().slice(0, 2000) : undefined;
    await report.save();

    await notifyOnce({
      recipient: report.fosterer,
      type: "FOSTER_REPORT_REVIEWED",
      title: "Your weekly foster report was reviewed",
      message: `Week ${report.weekNumber} report has been reviewed by staff.`,
      refModel: "Foster",
      refId: report.foster,
    });

    return res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
}

// GET /api/foster/my
async function myFosters(req, res, next) {
  try {
    const fosters = await Foster.find({ fosterer: req.user._id }).populate("pet").sort({ createdAt: -1 });
    return res.json({ success: true, data: fosters, meta: { shelterEmergencyPhone: process.env.SHELTER_EMERGENCY_PHONE || null } });
  } catch (err) {
    next(err);
  }
}

// POST /api/foster — staff, assigns a pet to a foster
async function create(req, res, next) {
  try {
    const application = await Application.findById(req.body.application);
    if (!application) {
      return res.status(404).json({ success: false, message: "Foster application not found" });
    }

    if (application.type !== "foster" || application.status !== "approved" || application.stage !== "approved") {
      return res.status(409).json({ success: false, message: "Foster placement requires an approved foster application" });
    }

    if (req.body.fosterer?.toString() !== application.applicant.toString() || req.body.pet?.toString() !== application.pet.toString()) {
      return res.status(409).json({ success: false, message: "Fosterer and pet must match the approved application" });
    }

    const pet = await Pet.findById(application.pet);
    if (!pet) return res.status(404).json({ success: false, message: "Pet not found" });
    if (pet.status !== "Foster" || pet.currentFosterer?.toString() !== application.applicant.toString()) {
      return res.status(409).json({ success: false, message: "Pet is not in the expected approved foster state" });
    }

    const existing = await Foster.findOne({ application: application._id, status: { $in: ["active"] } });
    if (existing) {
      return res.status(409).json({ success: false, message: "A foster placement already exists for this application" });
    }

    const startDate = new Date(req.body.startDate);
    if (Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid foster start date" });
    }

    // The foster period begins when the pet is handed over, so a pickup must be
    // booked first and the period can't start before it.
    const pickup = await AdoptionPickup.findOne({ application: application._id, status: { $in: ["scheduled", "completed"] } }).sort({ scheduledDate: -1 });
    if (!pickup) {
      return res.status(409).json({ success: false, message: "Schedule the pet pickup before starting the foster placement" });
    }
    if (dayOf(startDate) < dayOf(pickup.scheduledDate)) {
      return res.status(409).json({ success: false, message: "The foster period can't start before the pet is picked up" });
    }

    let trialDurationDays = req.body.trialDurationDays;
    let expectedEndDate;

    if (trialDurationDays !== undefined) {
      if (!Number.isInteger(trialDurationDays) || trialDurationDays < 30 || trialDurationDays > 60) {
        return res.status(400).json({ success: false, message: "Foster trial duration must be between 30 and 60 days" });
      }
      expectedEndDate = new Date(startDate);
      expectedEndDate.setDate(expectedEndDate.getDate() + trialDurationDays);
    } else if (req.body.expectedEndDate) {
      expectedEndDate = new Date(req.body.expectedEndDate);
      if (Number.isNaN(expectedEndDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid foster expected end date" });
      }
      trialDurationDays = Math.round((expectedEndDate.getTime() - startDate.getTime()) / 86400000);
      if (trialDurationDays < 30 || trialDurationDays > 60) {
        return res.status(400).json({ success: false, message: "Foster trial duration must be between 30 and 60 days" });
      }
    } else {
      return res.status(400).json({ success: false, message: "Foster trial duration or expected end date is required" });
    }

    // The trial dates are the source of truth for the number of weekly reports.
    // Ignore a client-supplied count so the monitoring workflow cannot drift
    // from the actual trial period.
    const weeklyReportsRequired = Math.ceil(trialDurationDays / 7);

    const foster = await Foster.create({
      ...req.body,
      startDate,
      expectedEndDate,
      trialDurationDays,
      weeklyReportsRequired,
      weeklyReportsSubmitted: 0,
      application: application._id,
      pet: application.pet,
      fosterer: application.applicant,
      assignedBy: req.user._id,
    });

    await notifyOnce({
      recipient: foster.fosterer,
      type: "FOSTER_STARTED",
      title: "Your foster placement has started",
      message: "You've been assigned a new foster pet. Check your foster dashboard for details.",
      refModel: "Foster",
      refId: foster._id,
    });

    return res.status(201).json({ success: true, data: foster });
  } catch (err) {
    next(err);
  }
}

// GET /api/foster — staff
async function list(req, res, next) {
  try {
    const fosters = await Foster.find().populate("pet fosterer").sort({ createdAt: -1 });
    return res.json({ success: true, data: fosters });
  } catch (err) {
    next(err);
  }
}

// GET /api/foster/:id
async function getOne(req, res, next) {
  try {
    const foster = await Foster.findById(req.params.id).populate("pet fosterer application");
    if (!foster) return res.status(404).json({ success: false, message: "Foster not found" });
    if (!canAccessFoster(foster, req.user)) return res.status(403).json({ success: false, message: "Not authorized to view this foster placement" });
    return res.json({ success: true, data: foster });
  } catch (err) {
    next(err);
  }
}

// PUT /api/foster/:id — staff
async function update(req, res, next) {
  try {
    const foster = await Foster.findById(req.params.id);
    if (!foster) return res.status(404).json({ success: false, message: "Foster not found" });

    for (const field of UPDATABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) foster[field] = req.body[field];
    }

    if (foster.status === "active" && (!foster.startDate || !foster.expectedEndDate || !foster.trialDurationDays)) {
      return res.status(409).json({ success: false, message: "An active foster must have a valid trial period" });
    }
    if (foster.status === "completed" && (!foster.application || !foster.startDate || !foster.endDate || !foster.trialDurationDays)) {
      return res.status(409).json({ success: false, message: "A completed foster must have a valid placement and trial period" });
    }
    const baseTrialDays = foster.trialDurationDays === undefined ? undefined : foster.trialDurationDays - (foster.extendedDays || 0);
    if (baseTrialDays !== undefined && (baseTrialDays < 30 || baseTrialDays > 60)) {
      return res.status(409).json({ success: false, message: "Foster trial duration must be between 30 and 60 days" });
    }

    await foster.save();
    return res.json({ success: true, data: foster });
  } catch (err) {
    next(err);
  }
}

// PUT /api/foster/:id/extend — staff. The placement stays active; the extension is recorded.
async function extend(req, res, next) {
  try {
    const foster = await Foster.findById(req.params.id);
    if (!foster) return res.status(404).json({ success: false, message: "Foster not found" });
    if (foster.status !== "active") {
      return res.status(409).json({ success: false, message: "Only an active foster placement can be extended" });
    }
    if (!foster.expectedEndDate || !foster.trialDurationDays) {
      return res.status(409).json({ success: false, message: "Foster placement has no valid trial period" });
    }

    // Checked here as well as in the route schema, so a direct call cannot shorten a placement.
    const { extensionDays, reason, vetAgreed, vetNotes, fostererAgreed } = req.body;
    const alreadyExtended = foster.extendedDays || 0;
    const days = validateExtensionDays(extensionDays, alreadyExtended);
    if (!days.ok) return res.status(days.status).json({ success: false, message: days.message });

    if (!fostererAgreed) {
      return res.status(409).json({ success: false, message: "The fosterer must agree to the extension" });
    }

    // Evidence: every report due so far must be in and reviewed by staff.
    const reports = await WeeklyFosterReport.find({ foster: foster._id });
    const evidence = evaluateReports(foster, reports);
    if (evidence.overdueWeeks.length > 0 || evidence.unreviewedWeeks.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Submit and review all due weekly reports before extending",
        data: { overdueWeeks: evidence.overdueWeeks, unreviewedWeeks: evidence.unreviewedWeeks },
      });
    }
    if (evidence.healthFlags.length > 0 && !vetAgreed) {
      return res.status(409).json({
        success: false,
        message: "A weekly report raised a health concern, so a veterinarian must agree to the extension",
        data: { healthFlags: evidence.healthFlags },
      });
    }

    const previousEnd = new Date(foster.expectedEndDate);
    const newEnd = new Date(previousEnd);
    newEnd.setDate(newEnd.getDate() + extensionDays);

    foster.extensions.push({
      days: extensionDays,
      reason,
      recommendedBy: req.body.recommendedBy || req.user._id,
      vetAgreed,
      vetNotes,
      fostererAgreed,
      authorizedBy: req.user._id,
      authorizedAt: new Date(),
      previousEndDate: previousEnd,
      newEndDate: newEnd,
    });
    foster.expectedEndDate = newEnd;
    foster.extendedDays = alreadyExtended + extensionDays;
    foster.trialDurationDays += extensionDays;
    foster.weeklyReportsRequired = Math.ceil(foster.trialDurationDays / 7);
    foster.endAlertStage = null; // alerts start over for the new end date
    await foster.save();

    await notifyOnce({
      recipient: foster.fosterer,
      type: "GENERAL",
      title: "Your foster period was extended",
      message: `Your foster period now runs until ${newEnd.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}. Weekly reports continue until then.`,
      refModel: "Foster",
      refId: foster._id,
      dedupeKey: `foster-extended:${foster._id}:${foster.extendedDays}`,
    });

    return res.json({ success: true, data: foster });
  } catch (err) {
    next(err);
  }
}

// PUT /api/foster/:id/end — staff. Completes a placement as ADOPTED or RETURNED.
async function end(req, res, next) {
  try {
    const { outcome, finalHealthCheck, completionException } = req.body;
    // The route schema already restricts this; the check is repeated so no other caller can
    // close a placement (and free the pet) with an unexpected value.
    if (!COMPLETION_OUTCOMES.includes(outcome)) {
      return res.status(400).json({
        success: false,
        message: `Outcome must be one of: ${COMPLETION_OUTCOMES.join(", ")}. To extend a placement use PUT /api/foster/:id/extend.`,
      });
    }

    const foster = await Foster.findById(req.params.id);
    if (!foster) return res.status(404).json({ success: false, message: "Foster not found" });
    if (foster.status !== "active") {
      return res.status(409).json({ success: false, message: "Only an active foster placement can be completed" });
    }
    if (!foster.application || !foster.startDate || !foster.expectedEndDate || !foster.trialDurationDays) {
      return res.status(409).json({ success: false, message: "Foster placement has no valid trial period" });
    }
    if (!finalHealthCheck?.notes) {
      return res.status(400).json({ success: false, message: "Record the staff health check before completing a placement" });
    }

    const reports = await WeeklyFosterReport.find({ foster: foster._id });
    const evidence = evaluateReports(foster, reports);

    // A submitted report is the fosterer's account, not proof of health: concerns need a vet.
    if (evidence.healthFlags.length > 0 && !finalHealthCheck.vetVerified) {
      return res.status(409).json({
        success: false,
        message: "A weekly report raised a health concern, so a veterinarian check is required before completing",
        data: { healthFlags: evidence.healthFlags },
      });
    }

    // Every required report must be submitted and reviewed, unless an admin records an exception.
    // An open emergency return is the one case that waives the gate: the pet comes back first.
    const incomplete = evidence.missingWeeks.length > 0 || evidence.unreviewedWeeks.length > 0;
    const openEmergencyReturn =
      outcome === "RETURNED" && foster.returnRequest?.status === "open" && foster.returnRequest?.urgency === "emergency";
    let exception = null;
    if (incomplete) {
      if (openEmergencyReturn) {
        exception = { reason: `Emergency return: ${foster.returnRequest.reason}`, by: req.user._id, at: new Date() };
      } else if (!completionException?.reason) {
        return res.status(409).json({
          success: false,
          message: "All weekly reports must be submitted and reviewed before completing",
          data: { missingWeeks: evidence.missingWeeks, unreviewedWeeks: evidence.unreviewedWeeks, canRequestException: EXCEPTION_ROLES.includes(req.user.role) },
        });
      } else if (!EXCEPTION_ROLES.includes(req.user.role)) {
        return res.status(403).json({ success: false, message: "Only an admin can complete a placement with missing or unreviewed reports" });
      } else {
        exception = { reason: completionException.reason, by: req.user._id, at: new Date() };
      }
      exception.missingWeeks = evidence.missingWeeks;
      exception.unreviewedWeeks = evidence.unreviewedWeeks;
    }

    const now = new Date();
    foster.status = "completed";
    foster.outcome = outcome;
    foster.returnNotes = req.body.returnNotes;
    foster.staffNotes = req.body.staffNotes;
    foster.finalHealthCheck = { notes: finalHealthCheck.notes, vetVerified: finalHealthCheck.vetVerified, checkedBy: req.user._id, checkedAt: now };
    if (exception) foster.completionException = exception;
    if (foster.returnRequest?.status === "open") {
      foster.returnRequest.status = "resolved";
      foster.returnRequest.resolvedAt = now;
    }
    foster.endDate = now;
    foster.closedAt = now;
    foster.endedBy = req.user._id;
    await foster.save();

    // The shelter keeps the animal until an adoption is finalized: a fosterer only becomes
    // `owner` when the outcome is ADOPTED, and a returned pet goes back to the shelter.
    if (outcome === "ADOPTED") {
      await Pet.findByIdAndUpdate(foster.pet, { status: "Adopted", owner: foster.fosterer, currentFosterer: null });
    } else {
      await Pet.findByIdAndUpdate(foster.pet, { status: "Available", owner: null, currentFosterer: null });
    }

    await notifyOnce({
      recipient: foster.fosterer,
      type: "FOSTER_ENDED",
      title: "Your foster placement has ended",
      message: `Outcome: ${outcome}.`,
      refModel: "Foster",
      refId: foster._id,
    });

    return res.json({ success: true, data: foster });
  } catch (err) {
    next(err);
  }
}

// POST /api/foster/:id/return-request — the fosterer or staff asks for an early or emergency return
async function requestReturn(req, res, next) {
  try {
    const foster = await Foster.findById(req.params.id).populate("pet", "name").populate("fosterer", "displayName phone");
    if (!foster) return res.status(404).json({ success: false, message: "Foster not found" });
    if (!canAccessFoster(foster, req.user)) return res.status(403).json({ success: false, message: "Not authorized for this foster placement" });
    if (foster.status !== "active") {
      return res.status(409).json({ success: false, message: "Only an active foster placement can be returned" });
    }

    const { urgency, reason } = req.body;
    const existing = foster.returnRequest;
    // An open request can be raised to an emergency, never quietly lowered.
    if (existing?.status === "open" && !(urgency === "emergency" && existing.urgency !== "emergency")) {
      return res.status(409).json({ success: false, message: "A return request is already open for this placement", data: foster.returnRequest });
    }

    foster.returnRequest = { urgency, reason, status: "open", requestedBy: req.user._id, requestedAt: new Date() };
    await foster.save();

    const petName = foster.pet?.name ?? "a pet";
    const who = foster.fosterer?.displayName ?? "The fosterer";
    const phone = foster.fosterer?.phone ? ` Phone: ${foster.fosterer.phone}.` : "";
    const contact = foster.emergencyContact?.phone ? ` Emergency contact: ${foster.emergencyContact.name} ${foster.emergencyContact.phone}.` : "";
    await notifyStaff({
      type: "FOSTER_RETURN_REQUEST",
      title: urgency === "emergency" ? "EMERGENCY foster return requested" : "Foster return requested",
      message: `${who} asked to return ${petName}: ${reason}.${phone}${contact}`,
      refModel: "Foster",
      refId: foster._id,
      dedupeKey: `foster-return:${foster._id}:${urgency}:${foster.returnRequest.requestedAt.getTime()}`,
    });

    return res.status(201).json({
      success: true,
      data: foster.returnRequest,
      meta: { shelterEmergencyPhone: process.env.SHELTER_EMERGENCY_PHONE || null },
    });
  } catch (err) {
    next(err);
  }
}

// PUT /api/foster/:id/emergency-contact — the fosterer or staff
async function setEmergencyContact(req, res, next) {
  try {
    const foster = await Foster.findById(req.params.id);
    if (!foster) return res.status(404).json({ success: false, message: "Foster not found" });
    if (!canAccessFoster(foster, req.user)) return res.status(403).json({ success: false, message: "Not authorized for this foster placement" });
    if (foster.status !== "active") {
      return res.status(409).json({ success: false, message: "Only an active foster placement can be updated" });
    }
    foster.emergencyContact = req.body;
    await foster.save();
    return res.json({ success: true, data: foster.emergencyContact });
  } catch (err) {
    next(err);
  }
}

// PUT /api/foster/:id/cancel — staff
async function cancel(req, res, next) {
  try {
    const foster = await Foster.findById(req.params.id);
    if (!foster) return res.status(404).json({ success: false, message: "Foster not found" });
    if (foster.status !== "active") {
      return res.status(409).json({ success: false, message: "Only an active foster placement can be cancelled" });
    }

    foster.status = "cancelled";
    foster.closedAt = new Date();
    foster.endedBy = req.user._id;
    await foster.save();

    await Pet.findByIdAndUpdate(foster.pet, { status: "Available", owner: null, currentFosterer: null });

    return res.json({ success: true, data: foster });
  } catch (err) {
    next(err);
  }
}

// GET /api/foster/:id/can-finalize
async function canFinalize(req, res, next) {
  try {
    const foster = await Foster.findById(req.params.id);
    if (!foster) return res.status(404).json({ success: false, message: "Foster not found" });

    const reports = await WeeklyFosterReport.find({ foster: foster._id });
    const evidence = evaluateReports(foster, reports);
    if (evidence.submitted !== foster.weeklyReportsSubmitted) {
      foster.weeklyReportsSubmitted = evidence.submitted;
      await foster.save();
    }

    const hasTrialPeriod = Boolean(
      foster.startDate &&
        foster.expectedEndDate &&
        foster.trialDurationDays - (foster.extendedDays || 0) >= 30 &&
        foster.trialDurationDays - (foster.extendedDays || 0) <= 60
    );
    const missingReports = evidence.missingWeeks.length;
    const unreviewedReports = evidence.unreviewedWeeks.length;
    return res.json({
      success: true,
      data: {
        canFinalize: hasTrialPeriod && missingReports === 0 && unreviewedReports === 0,
        missingReports,
        unreviewedReports,
        missingWeeks: evidence.missingWeeks,
        unreviewedWeeks: evidence.unreviewedWeeks,
        // Reports are self-reported: any health flag means a vet check is needed before completing.
        healthFlags: evidence.healthFlags,
        requiresVetCheck: evidence.healthFlags.length > 0,
        hasTrialPeriod,
        returnRequest: foster.returnRequest?.status === "open" ? foster.returnRequest : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/foster/:fosterId/reports
async function addReport(req, res, next) {
  try {
    const foster = await Foster.findById(req.params.fosterId);
    if (!foster) return res.status(404).json({ success: false, message: "Foster not found" });
    if (!canAccessFoster(foster, req.user)) return res.status(403).json({ success: false, message: "Not authorized to report on this foster placement" });
    if (foster.status !== "active") {
      return res.status(409).json({ success: false, message: "Weekly reports can only be submitted for an active foster placement" });
    }

    const weekNumber = Number(req.body.weekNumber);
    if (weekNumber > foster.weeklyReportsRequired) {
      return res.status(409).json({ success: false, message: "Report week is outside the foster trial period" });
    }

    const previousSubmitted = await WeeklyFosterReport.countDocuments({
      foster: foster._id,
      status: "submitted",
      weekNumber: { $lt: weekNumber },
    });
    if (previousSubmitted !== weekNumber - 1) {
      return res.status(409).json({
        success: false,
        message: "Weekly reports must be submitted in sequence",
      });
    }

    const dueDate = getFosterReportDueDate(foster, weekNumber);

    let report = await WeeklyFosterReport.findOne({
      foster: foster._id,
      weekNumber,
    });

    if (report?.status === "submitted") {
      return res.status(409).json({ success: false, message: "A report for this foster week already exists" });
    }

    if (report) {
      Object.assign(report, req.body);
      report.dueDate = dueDate;
      report.status = "submitted";
      report.reportDate = new Date();
      report.submittedAt = new Date();
      await report.save();
    } else {
      report = await WeeklyFosterReport.create({
        ...req.body,
        foster: foster._id,
        pet: foster.pet,
        fosterer: foster.fosterer,
        weekNumber,
        dueDate,
        status: "submitted",
        reportDate: new Date(),
        submittedAt: new Date(),
      });
    }

    foster.weeklyReportsSubmitted = await WeeklyFosterReport.countDocuments({
      foster: foster._id,
      status: "submitted",
    });
    await foster.save();

    return res.status(201).json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
}

// GET /api/foster/:fosterId/reports
async function listReports(req, res, next) {
  try {
    const foster = await Foster.findById(req.params.fosterId).select("fosterer");
    if (!foster) return res.status(404).json({ success: false, message: "Foster not found" });
    if (!canAccessFoster(foster, req.user)) return res.status(403).json({ success: false, message: "Not authorized to view these reports" });
    const reports = await WeeklyFosterReport.find({ foster: req.params.fosterId }).sort({ weekNumber: 1 });
    return res.json({ success: true, data: reports });
  } catch (err) {
    next(err);
  }
}

// GET /api/foster/:fosterId/reports/missing
async function missingReports(req, res, next) {
  try {
    const foster = await Foster.findById(req.params.fosterId);
    if (!foster) return res.status(404).json({ success: false, message: "Foster not found" });

    const reports = await WeeklyFosterReport.find({ foster: foster._id }).select("weekNumber status dueDate");
    const byWeek = new Map(reports.map((report) => [report.weekNumber, report]));
    const missing = [];
    const overdue = [];
    const now = new Date();

    for (let week = 1; week <= foster.weeklyReportsRequired; week += 1) {
      const report = byWeek.get(week);
      const dueDate = report?.dueDate || getFosterReportDueDate(foster, week);
      if (!report || report.status !== "submitted") {
        missing.push(week);
        if (dueDate <= now) overdue.push(week);
      }
    }

    return res.json({ success: true, data: { missingWeeks: missing, overdueWeeks: overdue } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  pendingReports,
  reviewReport,
  myFosters,
  create,
  list,
  getOne,
  update,
  extend,
  end,
  requestReturn,
  setEmergencyContact,
  cancel,
  canFinalize,
  addReport,
  listReports,
  missingReports,
};
