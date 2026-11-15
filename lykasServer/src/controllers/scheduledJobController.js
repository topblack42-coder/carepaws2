const ScheduledJobLog = require("../models/ScheduledJobLog");
const { runVaccinationReminders, runDocumentExpiryReminders, runFosterReportMonitoring, runFosterEndDateAlerts, runMonitoringReportMonitoring } = require("../jobs/reminderJobs");

const JOBS = {
  vaccination_reminders: runVaccinationReminders,
  document_expiry_reminders: runDocumentExpiryReminders,
  foster_report_monitoring: runFosterReportMonitoring,
  foster_end_date_alerts: runFosterEndDateAlerts,
  monitoring_report_monitoring: runMonitoringReportMonitoring,
};

// GET /api/scheduled-jobs — list known job keys + their most recent run
async function list(req, res, next) {
  try {
    const keys = Object.keys(JOBS);
    const data = await Promise.all(
      keys.map(async (jobKey) => {
        const lastRun = await ScheduledJobLog.findOne({ jobKey }).sort({ startedAt: -1 });
        return { jobKey, lastRun };
      })
    );
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// GET /api/scheduled-jobs/:jobKey/history
async function history(req, res, next) {
  try {
    const logs = await ScheduledJobLog.find({ jobKey: req.params.jobKey }).sort({ startedAt: -1 }).limit(50);
    return res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
}

// POST /api/scheduled-jobs/:jobKey/run — manual trigger, super_admin only
async function run(req, res, next) {
  try {
    const jobFn = JOBS[req.params.jobKey];
    if (!jobFn) return res.status(404).json({ success: false, message: "Unknown job key" });

    const result = await jobFn({ triggeredBy: "manual", triggeredByUser: req.user._id });
    return res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, history, run };
