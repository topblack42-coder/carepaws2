const express = require("express");
const router = express.Router();
const MonitoringReport = require("../models/MonitoringReport");
const Application = require("../models/Application");
const Pet = require("../models/Pet");
const User = require("../models/User");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const validateRequest = require("../middleware/validateRequest");
const { monitoringReportCreateSchema, monitoringReportReviewSchema } = require("../validators/monitoringReport.schema");
const { buildPagination } = require("../utils/queryBuilder");
const { notify } = require("../utils/notificationHelper");

const REPORT_POPULATE = [
  { path: "pet" },
  { path: "submittedBy", select: "displayName email" },
  { path: "application" },
  { path: "reviewedBy", select: "displayName email" },
];

const { MONITORING_PERIODS, getApplicationCompletionDate, getMonitoringSchedule } = require("../utils/monitoringSchedule");

async function getOrCreateScheduledReport(application, monitoringPeriod) {
  if (
    application.type !== "adoption" ||
    application.status !== "approved" ||
    application.stage !== "completed" ||
    !MONITORING_PERIODS.includes(monitoringPeriod)
  ) {
    return null;
  }

  const existing = await MonitoringReport.findOne({ application: application._id, monitoringPeriod });
  if (existing) return existing;

  const schedule = getMonitoringSchedule(application, monitoringPeriod);
  return MonitoringReport.findOneAndUpdate(
    { application: application._id, monitoringPeriod },
    {
      $setOnInsert: {
        application: application._id,
        submittedBy: application.applicant,
        pet: application.pet,
        ...schedule,
        status: schedule.scheduledDate <= new Date() ? "pending" : "scheduled",
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

router.get("/my", protect, async (req, res, next) => {
  try {
    const applications = await Application.find({
      applicant: req.user._id,
      type: "adoption",
      status: "approved",
      stage: "completed",
    }).select("_id applicant pet type status stage stageHistory updatedAt");

    const reports = [];
    for (const application of applications) {
      for (const period of MONITORING_PERIODS) {
        const report = await getOrCreateScheduledReport(application, period);
        if (report) reports.push(report);
      }
    }

    const applicationIds = applications.map((application) => application._id);
    const data = applicationIds.length
      ? await MonitoringReport.find({ submittedBy: req.user._id, application: { $in: applicationIds } })
          .populate(REPORT_POPULATE)
          .sort({ scheduledDate: 1, createdAt: -1 })
      : [];

    res.json({
      success: true,
      data,
      next: data.find((report) => ["pending", "scheduled"].includes(report.status)),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/flagged", protect, adminOnly, async (req, res, next) => {
  try {
    const data = await MonitoringReport.find({ status: "flagged" }).populate(REPORT_POPULATE).sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get("/pet/:petId", protect, adminOnly, async (req, res, next) => {
  try {
    const data = await MonitoringReport.find({ pet: req.params.petId }).populate(REPORT_POPULATE).sort({ scheduledDate: 1 });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post("/", protect, validateRequest(monitoringReportCreateSchema), async (req, res, next) => {
  try {
    const applicationQuery = req.body.application
      ? { _id: req.body.application, applicant: req.user._id, type: "adoption", status: "approved", stage: "completed" }
      : { applicant: req.user._id, pet: req.body.pet, type: "adoption", status: "approved", stage: "completed" };

    const application = await Application.findOne(applicationQuery).select("_id applicant pet type status stage stageHistory updatedAt");
    if (!application) {
      return res.status(409).json({ success: false, message: "Post-adoption monitoring is available only after the adoption is finalized" });
    }

    if (req.body.pet && req.body.pet.toString() !== application.pet.toString()) {
      return res.status(409).json({ success: false, message: "The selected pet does not belong to this adoption" });
    }

    let monitoringPeriod = req.body.monitoringPeriod;
    if (!monitoringPeriod) {
      const completionDate = getApplicationCompletionDate(application);
      const now = new Date();
      monitoringPeriod = Math.max(
        1,
        Math.min(3, Math.floor((now.getTime() - completionDate.getTime()) / (30 * 24 * 60 * 60 * 1000)) + 1)
      );
    }
    if (!MONITORING_PERIODS.includes(monitoringPeriod)) {
      return res.status(409).json({ success: false, message: "This adoption has no remaining monitoring period" });
    }

    const priorIncomplete = await MonitoringReport.findOne({
      application: application._id,
      monitoringPeriod: { $lt: monitoringPeriod },
      status: { $in: ["scheduled", "pending", "flagged"] },
    }).sort({ monitoringPeriod: 1 });
    if (priorIncomplete) {
      return res.status(409).json({ success: false, message: `Complete monitoring check-in ${priorIncomplete.monitoringPeriod} before submitting this period` });
    }

    const report = await getOrCreateScheduledReport(application, monitoringPeriod);
    if (!report) return res.status(409).json({ success: false, message: "Monitoring schedule is unavailable" });

    if (report.status === "reviewed") {
      return res.status(409).json({ success: false, message: "This monitoring period is already completed" });
    }
    if (report.status === "flagged") {
      return res.status(409).json({ success: false, message: "This monitoring period has already been submitted and flagged for follow-up" });
    }

    if (report.scheduledDate > new Date()) {
      return res.status(409).json({ success: false, message: `This monitoring report is scheduled for ${report.scheduledDate.toISOString()}` });
    }

    Object.assign(report, {
      pet: application.pet,
      application: application._id,
      submittedBy: application.applicant,
      currentWeight: req.body.currentWeight,
      diet: req.body.diet,
      exerciseRoutine: req.body.exerciseRoutine,
      vetVisits: req.body.vetVisits,
      overallCondition: req.body.overallCondition,
      behaviorAtHome: req.body.behaviorAtHome,
      issuesOrConcerns: req.body.issuesOrConcerns,
      additionalPets: req.body.additionalPets,
      satisfactionRating: req.body.satisfactionRating,
      comments: req.body.comments,
      reportDate: new Date(),
      submittedAt: new Date(),
      status: "pending",
      reportMonth: report.reportMonth,
      monitoringPeriod,
    });
    await report.save();

    await report.populate(REPORT_POPULATE);
    res.status(201).json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

router.get("/", protect, adminOnly, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.q) {
      const matchingApplications = await Application.find({
        $or: [
          { _id: req.query.q.match(/^[a-f\d]{24}$/i) ? req.query.q : undefined },
        ].filter(Boolean),
      }).select("_id");
      const matchingPets = await Pet.find({ name: { $regex: req.query.q, $options: "i" } }).select("_id");
      const matchingUsers = await User.find({ displayName: { $regex: req.query.q, $options: "i" } }).select("_id");
      filter.$or = [
        ...(matchingApplications.length ? [{ application: { $in: matchingApplications.map((item) => item._id) } }] : []),
        ...(matchingPets.length ? [{ pet: { $in: matchingPets.map((item) => item._id) } }] : []),
        ...(matchingUsers.length ? [{ submittedBy: { $in: matchingUsers.map((item) => item._id) } }] : []),
      ];
      if (!filter.$or.length) return res.json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } });
    }
    const total = await MonitoringReport.countDocuments(filter);
    const { page, limit, skip, ...paginationRest } = buildPagination(total, req.query.page, req.query.limit);
    const data = await MonitoringReport.find(filter)
      .populate(REPORT_POPULATE)
      .sort({ scheduledDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit);
    res.json({ success: true, data, pagination: { page, limit, ...paginationRest } });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", protect, async (req, res, next) => {
  try {
    const report = await MonitoringReport.findById(req.params.id).populate(REPORT_POPULATE);
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
    const isStaff = ["staff", "admin", "super_admin"].includes(req.user.role);
    const ownerId = report.submittedBy?._id || report.submittedBy;
    if (!isStaff && String(ownerId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to view this report" });
    }
    const result = report.toObject();
    if (!isStaff && result.application) delete result.application.internalNotes; // staff-only
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/review", protect, adminOnly, validateRequest(monitoringReportReviewSchema), async (req, res, next) => {
  try {
    const report = await MonitoringReport.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
    if (!report.submittedAt || !report.reportDate) {
      return res.status(409).json({ success: false, message: "Only submitted monitoring reports can be reviewed" });
    }
    if (report.status === "reviewed") {
      return res.status(409).json({ success: false, message: "Monitoring report is already completed" });
    }

    const nextStatus = req.body.status || "reviewed";
    report.status = nextStatus;
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();
    report.completedAt = nextStatus === "reviewed" ? report.reviewedAt : null;
    report.adminNotes = req.body.adminNotes;
    await report.save();

    await notify({
      recipient: report.submittedBy,
      sender: req.user._id,
      type: nextStatus === "reviewed" ? "MONITORING_REPORT_REVIEWED" : "MONITORING_REPORT_FLAGGED",
      title: nextStatus === "reviewed" ? "Monitoring check-in completed" : "Monitoring check-in needs follow-up",
      message:
        nextStatus === "reviewed"
          ? `Your check-in for ${report.reportMonth} has been reviewed and completed.`
          : `Your check-in for ${report.reportMonth} was flagged for follow-up.`,
      refModel: "MonitoringReport",
      refId: report._id,
    });

    await report.populate(REPORT_POPULATE);
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
