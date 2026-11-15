const Interview = require("../models/Interview");
const Application = require("../models/Application");
const UserDocument = require("../models/UserDocument");
const { advanceApplicationStage } = require("./applicationController");
const { notifyOnce } = require("../utils/notificationHelper");

async function myInterviews(req, res, next) {
  try {
    const data = await Interview.find({ applicant: req.user._id }).populate("pet").sort({ scheduledDate: 1 });
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const application = await Application.findById(req.body.application).select("applicant pet status stage type");
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    if (application.status === "rejected") return res.status(409).json({ success: false, message: "Cannot schedule an interview for a rejected application" });
    if (application.stage !== "document_review") {
      return res.status(409).json({ success: false, message: "Application must be in document review before an interview can be scheduled" });
    }

    const documents = await UserDocument.find({ application: application._id }).select("status");
    if (documents.length === 0) {
      return res.status(409).json({ success: false, message: "At least one application document must be uploaded and verified before the interview" });
    }
    if (documents.some((document) => document.status !== "verified")) {
      return res.status(409).json({ success: false, message: "All application documents must be verified before the interview" });
    }

    const interview = await Interview.create({
      ...req.body,
      applicant: application.applicant,
      pet: application.pet,
    });
    await notifyOnce({
      recipient: interview.applicant,
      type: "INTERVIEW_SCHEDULED",
      title: "Interview scheduled",
      message: `Your adoption interview is scheduled for ${new Date(interview.scheduledDate).toLocaleString()}.`,
      refModel: "Interview",
      refId: interview._id,
      dedupeKey: `interview-rescheduled:${interview._id}:${interview.scheduledDate?.getTime() || Date.now()}`,
    });
    return res.status(201).json({ success: true, data: interview });
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const data = await Interview.find().populate("applicant pet conductedBy").sort({ scheduledDate: -1 });
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const interview = await Interview.findById(req.params.id).populate("applicant pet conductedBy application");
    if (!interview) return res.status(404).json({ success: false, message: "Interview not found" });
    const isStaff = ["staff", "admin", "super_admin"].includes(req.user.role);
    const ownerId = interview.applicant?._id || interview.applicant;
    if (!isStaff && String(ownerId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to view this interview" });
    }
    const result = interview.toObject();
    if (!isStaff && result.application) delete result.application.internalNotes; // staff-only
    return res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const existing = await Interview.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Interview not found" });

    const updates = { ...req.body };
    if (updates.application) {
      const application = await Application.findById(updates.application).select("applicant pet status");
      if (!application) return res.status(404).json({ success: false, message: "Application not found" });
      if (application.status === "rejected") return res.status(409).json({ success: false, message: "Cannot assign an interview to a rejected application" });
      updates.applicant = application.applicant;
      updates.pet = application.pet;
    } else {
      updates.applicant = existing.applicant;
      updates.pet = existing.pet;
    }

    const interview = await Interview.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    await notifyOnce({
      recipient: interview.applicant,
      type: "INTERVIEW_RESCHEDULED",
      title: "Interview rescheduled",
      message: `Your interview has been updated to ${new Date(interview.scheduledDate).toLocaleString()}.`,
      refModel: "Interview",
      refId: interview._id,
    });
    return res.json({ success: true, data: interview });
  } catch (err) {
    next(err);
  }
}

async function complete(req, res, next) {
  try {
    const interview = await Interview.findById(req.params.id);
    if (!interview) return res.status(404).json({ success: false, message: "Interview not found" });

    const application = await Application.findById(interview.application);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    if (application.stage !== "interview") {
      return res.status(409).json({ success: false, message: "Application is no longer at the interview stage" });
    }

    interview.status = "completed";
    interview.result = req.body.result;
    interview.notes = req.body.notes;
    interview.completedAt = new Date();
    await interview.save();

    if (interview.result === "passed") {
      await advanceApplicationStage(application, "home_visit", req.user._id, "Interview passed");
    }

    await notifyOnce({
      recipient: interview.applicant,
      type: "INTERVIEW_RESULT",
      title: "Interview result available",
      message: `Your interview result: ${interview.result}.`,
      refModel: "Interview",
      refId: interview._id,
    });

    return res.json({ success: true, data: interview });
  } catch (err) {
    next(err);
  }
}

async function cancel(req, res, next) {
  try {
    const interview = await Interview.findById(req.params.id);
    if (!interview) return res.status(404).json({ success: false, message: "Interview not found" });

    interview.status = "cancelled";
    interview.cancelReason = req.body.cancelReason;
    await interview.save();

    await notifyOnce({
      recipient: interview.applicant,
      type: "INTERVIEW_CANCELLED",
      title: "Interview cancelled",
      message: interview.cancelReason || "Your interview has been cancelled.",
      refModel: "Interview",
      refId: interview._id,
    });

    return res.json({ success: true, data: interview });
  } catch (err) {
    next(err);
  }
}

async function noShow(req, res, next) {
  try {
    const interview = await Interview.findByIdAndUpdate(req.params.id, { status: "no-show" }, { new: true });
    if (!interview) return res.status(404).json({ success: false, message: "Interview not found" });
    return res.json({ success: true, data: interview });
  } catch (err) {
    next(err);
  }
}

module.exports = { myInterviews, create, list, getOne, update, complete, cancel, noShow };
