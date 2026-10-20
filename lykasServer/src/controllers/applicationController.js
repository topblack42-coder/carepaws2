const Application = require("../models/Application");
const Pet = require("../models/Pet");
const User = require("../models/User");
const { buildListQuery, buildSort, buildPagination } = require("../utils/queryBuilder");
const { writeAuditLog } = require("../utils/auditLogger");
const { notifyOnce } = require("../utils/notificationHelper");

const SEARCH_FIELDS = ["address", "experience"];
const FILTER_FIELDS = ["status", "stage", "type", "pet", "applicant"];
const STAGE_ORDER = [
  "submitted",
  "document_review",
  "interview",
  "home_visit",
  "risk_assessment",
  "approved",
  "adoption_scheduled",
  "completed",
];

function assertStageTransition(application, nextStage) {
  if (nextStage === "rejected") {
    if (application.status !== "pending") {
      throw Object.assign(new Error("Only a pending application can be rejected"), { statusCode: 409 });
    }
    if (application.stage !== "risk_assessment") {
      throw Object.assign(new Error("Application must complete the required review stages before a final decision"), { statusCode: 409 });
    }
    return;
  }

  const currentIndex = STAGE_ORDER.indexOf(application.stage);
  const nextIndex = STAGE_ORDER.indexOf(nextStage);
  if (currentIndex < 0 || nextIndex !== currentIndex + 1) {
    throw Object.assign(new Error(`Application must progress from ${application.stage} to the next required stage`), { statusCode: 409 });
  }

  if (nextStage === "approved" && application.stage !== "risk_assessment") {
    throw Object.assign(new Error("Application must complete risk assessment before approval"), { statusCode: 409 });
  }
  if (nextStage === "adoption_scheduled" && application.status !== "approved") {
    throw Object.assign(new Error("Only an approved application can be scheduled for adoption"), { statusCode: 409 });
  }
  if (nextStage === "completed" && application.status !== "approved") {
    throw Object.assign(new Error("Only an approved application can be finalized"), { statusCode: 409 });
  }
}

async function advanceApplicationStage(application, nextStage, changedBy, note) {
  assertStageTransition(application, nextStage);
  application.stage = nextStage;
  if (nextStage === "approved") {
    application.status = "approved";
    application.reviewedBy = changedBy;
    application.reviewedAt = new Date();
  }
  if (nextStage === "rejected") {
    application.status = "rejected";
    application.reviewedBy = changedBy;
    application.reviewedAt = new Date();
  }
  application.stageHistory.push({
    stage: nextStage,
    changedBy,
    note: note || `Application moved to ${nextStage}`,
  });
  await application.save();
  return application;
}


// Fields populated on an application whenever it's returned to a client
// that needs to display it (detail views, and any endpoint whose response
// a screen writes straight into its local state). Kept in one place so
// every mutation endpoint stays in sync with what getApplication returns —
// the previous drift here (status/stage updates skipping this) is what let
// the pet/applicant/note-author names disappear from the admin screen
// after any stage or status change.
const APPLICATION_POPULATE = [
  { path: "pet" },
  { path: "applicant" },
  { path: "reviewedBy" },
  { path: "internalNotes.author", select: "displayName" },
];

// GET /api/applications/my
async function myApplications(req, res, next) {
  try {
    const applications = await Application.find({ applicant: req.user._id }).populate("pet").sort({ createdAt: -1 });
    return res.json({ success: true, data: applications });
  } catch (err) {
    next(err);
  }
}

// GET /api/applications — staff
async function listApplications(req, res, next) {
  try {
    const filter = buildListQuery(req.query, { searchFields: SEARCH_FIELDS, filterFields: FILTER_FIELDS, allowIncludeDeleted: false });
    const sort = buildSort(req.query);
    const total = await Application.countDocuments(filter);
    const { page, limit, skip, ...paginationRest } = buildPagination(total, req.query.page, req.query.limit);

    const data = await Application.find(filter).populate("pet applicant").sort(sort).skip(skip).limit(limit);

    return res.json({ success: true, data, pagination: { page, limit, ...paginationRest } });
  } catch (err) {
    next(err);
  }
}

// GET /api/applications/:id
async function getApplication(req, res, next) {
  try {
    const application = await Application.findById(req.params.id).populate(APPLICATION_POPULATE);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });

    const isOwner = application.applicant._id.toString() === req.user._id.toString();
    const isStaff = ["staff", "admin", "super_admin"].includes(req.user.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({ success: false, message: "Not authorized to view this application" });
    }

    const result = application.toObject();
    if (!isStaff) delete result.internalNotes; // internal notes are hidden from the applicant

    return res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// POST /api/applications
async function createApplication(req, res, next) {
  try {
    const pet = await Pet.findOne({ _id: req.body.pet, isDeleted: { $ne: true } });
    if (!pet) return res.status(404).json({ success: false, message: "Pet not found" });
    if (pet.status !== "Available") {
      return res.status(409).json({ success: false, message: "This pet is not currently available" });
    }

    // Self-service submissions always belong to the authenticated caller.
    // Staff recording a walk-in application (Admin > New application) may
    // specify who the actual applicant is via `applicant`; previously this
    // field was ignored entirely and every staff-recorded application was
    // silently attributed to the staff member's own account.
    const isStaff = ["staff", "admin", "super_admin"].includes(req.user.role);
    let applicantId = req.user._id;
    if (isStaff && req.body.applicant) {
      const applicantUser = await User.findOne({ _id: req.body.applicant, isDeleted: { $ne: true } });
      if (!applicantUser) {
        return res.status(404).json({ success: false, message: "Applicant not found" });
      }
      applicantId = applicantUser._id;
    }

    const activeApplication = await Application.findOne({
      pet: pet._id,
      status: { $in: ["pending", "approved"] },
    }).select("_id applicant status");
    if (activeApplication) {
      return res.status(409).json({ success: false, message: "This pet already has an active application" });
    }

    const { applicant: _ignoredApplicant, ...applicationFields } = req.body;
    const application = await Application.create({
      ...applicationFields,
      applicant: applicantId,
      stageHistory: [{ stage: "submitted", changedBy: req.user._id, note: "Application submitted" }],
    });
    await application.populate(APPLICATION_POPULATE);

    pet.status = "Pending";
    await pet.save();

    return res.status(201).json({ success: true, data: application });
  } catch (err) {
    if (err?.code === 11000 && err?.keyPattern?.pet) {
      return res.status(409).json({ success: false, message: "This pet already has an active application" });
    }
    next(err);
  }
}

// PUT /api/applications/:id/status — staff
async function updateStatus(req, res, next) {
  try {
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });

    const previousValues = { status: application.status, stage: application.stage };
    const nextStatus = req.body.status;

    if (application.status === "approved" && nextStatus !== "approved") {
      return res.status(409).json({ success: false, message: "An approved application cannot be reopened or rejected" });
    }
    if (application.status === "rejected" && nextStatus !== "rejected") {
      return res.status(409).json({ success: false, message: "A rejected application cannot be reopened" });
    }
    if (nextStatus === "pending") {
      if (application.status !== "pending") {
        return res.status(409).json({ success: false, message: "Only an active application can remain pending" });
      }
      return res.json({ success: true, data: await application.populate(APPLICATION_POPULATE) });
    }
    if (application.stage !== "risk_assessment") {
      return res.status(409).json({ success: false, message: "Complete document review, interview, home visit, and risk assessment before making a final decision" });
    }

    const nextStage = nextStatus === "approved" ? "approved" : "rejected";
    await advanceApplicationStage(application, nextStage, req.user._id, req.body.note || `Application ${nextStatus}`);

    const statusType = nextStatus === "approved" ? (application.type === "foster" ? "FOSTER_APPROVED" : "APPLICATION_APPROVED") : "APPLICATION_REJECTED";
    await notifyOnce({
      recipient: application.applicant,
      sender: req.user._id,
      type: "APPLICATION_STATUS_CHANGED",
      title: `Application ${nextStatus}`,
      message: req.body.note || `Your ${application.type} application status changed to ${nextStatus}.`,
      refModel: "Application",
      refId: application._id,
      dedupeKey: `application-status:${application._id}:${nextStatus}`,
    });
    await notifyOnce({
      recipient: application.applicant,
      sender: req.user._id,
      type: statusType,
      title: nextStatus === "approved" ? (application.type === "foster" ? "Foster application approved" : "Adoption application approved") : "Application rejected",
      message: nextStatus === "approved" ? (application.type === "foster" ? "Your foster application has been approved." : "Your adoption application has been approved.") : (req.body.note || "Your application was not approved."),
      refModel: "Application",
      refId: application._id,
      dedupeKey: `application-decision:${application._id}:${nextStatus}`,
    });

    if (nextStatus === "approved") {
      await Pet.findByIdAndUpdate(application.pet, {
        status: application.type === "foster" ? "Foster" : "Adopted",
        owner: application.applicant,
      });
    } else {
      await Pet.findByIdAndUpdate(application.pet, { status: "Available", owner: null });
    }

    await writeAuditLog({
      actor: req.user._id,
      action: "application.status_update",
      entityType: "Application",
      entityId: application._id,
      previousValues,
      newValues: { status: application.status, stage: application.stage },
      req,
    });

    await application.populate(APPLICATION_POPULATE);
    return res.json({ success: true, data: application });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
}

// PUT /api/applications/:id/stage — staff, moves exactly one pipeline stage
async function updateStage(req, res, next) {
  try {
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    if (application.status === "rejected") {
      return res.status(409).json({ success: false, message: "A rejected application cannot re-enter the adoption pipeline" });
    }
    if (application.stage === "completed") {
      return res.status(409).json({ success: false, message: "A completed application cannot move to another stage" });
    }

    const previousStage = application.stage;
    const nextStage = req.body.stage;
    assertStageTransition(application, nextStage);

    await advanceApplicationStage(application, nextStage, req.user._id, req.body.note);

    if (nextStage === "approved") {
      await Pet.findByIdAndUpdate(application.pet, {
        status: application.type === "foster" ? "Foster" : "Adopted",
        owner: application.applicant,
      });
    } else if (nextStage === "rejected") {
      await Pet.findByIdAndUpdate(application.pet, { status: "Available", owner: null });
    }

    await writeAuditLog({
      actor: req.user._id,
      action: "application.stage_update",
      entityType: "Application",
      entityId: application._id,
      previousValues: { stage: previousStage },
      newValues: { stage: application.stage, status: application.status },
      req,
    });

    await application.populate(APPLICATION_POPULATE);
    return res.json({ success: true, data: application });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
}

// GET /api/applications/:id/notes — staff
async function getNotes(req, res, next) {
  try {
    const application = await Application.findById(req.params.id).select("internalNotes").populate("internalNotes.author", "displayName");
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    return res.json({ success: true, data: application.internalNotes });
  } catch (err) {
    next(err);
  }
}

// POST /api/applications/:id/notes — staff
async function addNote(req, res, next) {
  try {
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });

    application.internalNotes.push({ author: req.user._id, text: req.body.text });
    await application.save();
    // Without this, the note the staff member just wrote shows up as
    // "Staff" (the UI's fallback for a missing author) instead of their
    // name until the page is reloaded from GET /:id.
    await application.populate("internalNotes.author", "displayName");

    return res.status(201).json({ success: true, data: application.internalNotes });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/applications/:id — staff
//
// NOTE: This is a deliberate exception to the soft-delete convention used
// elsewhere in this backend (Pet, User, Volunteer, InKindDonation all use
// isDeleted/deletedAt/deletedBy — see README.md "Delete pattern"). An
// approved application can never reach this line (blocked below), so only
// pending/rejected applications are ever hard-deleted here, and those don't
// carry the same retention requirement as a completed adoption record.
// stageHistory/internalNotes on a deleted application are lost — if that
// audit trail ever needs to survive deletion (e.g. a future compliance
// requirement), switch this to soft-delete to match the other models rather
// than adding a one-off retention mechanism just for Application.
async function deleteApplication(req, res, next) {
  try {
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    if (application.status === "approved") {
      return res.status(409).json({ success: false, message: "An approved application cannot be deleted" });
    }

    await Application.findByIdAndDelete(application._id);

    if (application.status === "pending") {
      await Pet.findByIdAndUpdate(application.pet, { status: "Available", owner: null });
    }

    await writeAuditLog({ actor: req.user._id, action: "application.delete", entityType: "Application", entityId: application._id, req });

    return res.json({ success: true, message: "Application deleted" });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  myApplications,
  listApplications,
  getApplication,
  createApplication,
  updateStatus,
  updateStage,
  advanceApplicationStage,
  getNotes,
  addNote,
  deleteApplication,
};
