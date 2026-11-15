const cron = require("node-cron");
const logger = require("./utils/logger");
const { runVaccinationReminders, runDocumentExpiryReminders, runFosterReportMonitoring, runFosterEndDateAlerts, runMonitoringReportMonitoring } = require("./jobs/reminderJobs");

/**
 * node-cron scheduler bootstrap. Called once from server.js after the DB
 * connection is established. Each job also supports a manual trigger via
 * POST /api/scheduled-jobs/:jobKey/run (see scheduledJobRoutes.js), which
 * reuses these same functions with triggeredBy: "manual".
 */
function startCronJobs() {
  // Every day at 7:00 AM server time.
  cron.schedule("0 7 * * *", async () => {
    logger.info("Running scheduled job: vaccination_reminders");
    await runVaccinationReminders();
  });

  // Every day at 7:15 AM server time.
  cron.schedule("15 7 * * *", async () => {
    logger.info("Running scheduled job: document_expiry_reminders");
    await runDocumentExpiryReminders();
  });

  // Every day at 7:30 AM server time.
  cron.schedule("30 7 * * *", async () => {
    logger.info("Running scheduled job: foster_report_monitoring");
    await runFosterReportMonitoring();
  });

  // Every day at 7:40 AM server time.
  cron.schedule("40 7 * * *", async () => {
    logger.info("Running scheduled job: foster_end_date_alerts");
    await runFosterEndDateAlerts();
  });

  // Every day at 7:45 AM server time.
  cron.schedule("45 7 * * *", async () => {
    logger.info("Running scheduled job: monitoring_report_monitoring");
    await runMonitoringReportMonitoring();
  });

  logger.info(
    "Cron jobs scheduled: vaccination_reminders (07:00), document_expiry_reminders (07:15), foster_report_monitoring (07:30), foster_end_date_alerts (07:40), monitoring_report_monitoring (07:45)"
  );
}

module.exports = startCronJobs;
