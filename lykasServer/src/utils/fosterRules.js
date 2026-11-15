/**
 * Pure foster-placement rules. No database access, so they are easy to test
 * and the controller, the daily job and the admin UI all agree on the numbers.
 */
const { getFosterReportDueDate } = require("../models/Foster");

const DAY_MS = 24 * 60 * 60 * 1000;

// The original trial is 30-60 days; staff may add extension days on top.
const MIN_EXTENSION_DAYS = 7;
const MAX_EXTENSION_DAYS = 30;

// A completed placement ends in one of these. EXTENDED is not an ending:
// an extended placement stays active (see the /extend endpoint).
const COMPLETION_OUTCOMES = ["ADOPTED", "RETURNED"];

/** Checks a requested extension against the per-request and total limits. */
function validateExtensionDays(extensionDays, alreadyExtended = 0) {
  if (!Number.isInteger(extensionDays)) {
    return { ok: false, status: 400, message: "Choose how many days to extend the foster period" };
  }
  if (extensionDays < MIN_EXTENSION_DAYS) {
    return { ok: false, status: 400, message: `An extension must be at least ${MIN_EXTENSION_DAYS} days` };
  }
  if (alreadyExtended + extensionDays > MAX_EXTENSION_DAYS) {
    return {
      ok: false,
      status: 409,
      message: `A foster placement can be extended by at most ${MAX_EXTENSION_DAYS} days in total (${alreadyExtended} already used)`,
    };
  }
  return { ok: true };
}

function reportHealthReasons(report) {
  const reasons = [];
  if (report.overallProgress === "Needs Attention") reasons.push("marked Needs Attention");
  if (report.vetVisitRequired) reasons.push("vet visit requested");
  if (report.appetite === "Poor") reasons.push("poor appetite");
  if (report.energy === "Lethargic") reasons.push("lethargic");
  if (typeof report.healthConcerns === "string" && report.healthConcerns.trim()) reasons.push("health concerns reported");
  return reasons;
}

/**
 * Summarises the weekly-report evidence for a placement.
 * - missingWeeks: required weeks with no submitted report
 * - overdueWeeks: missing weeks whose due date has already passed
 * - unreviewedWeeks: submitted weeks no staff member has reviewed yet
 * - healthFlags: submitted reports that describe a possible health problem
 *
 * A submitted report is the fosterer's claim, not proof the animal is well,
 * which is why completion also needs a staff health check (see end()).
 */
function evaluateReports(foster, reports, now = new Date()) {
  const byWeek = new Map();
  for (const report of reports) byWeek.set(report.weekNumber, report);

  const required = Number(foster.weeklyReportsRequired) || 0;
  const missingWeeks = [];
  const overdueWeeks = [];
  const unreviewedWeeks = [];
  const healthFlags = [];

  for (let week = 1; week <= required; week += 1) {
    const report = byWeek.get(week);
    if (!report || report.status !== "submitted") {
      missingWeeks.push(week);
      const due = report?.dueDate || getFosterReportDueDate(foster, week);
      if (due <= now) overdueWeeks.push(week);
      continue;
    }
    if (!report.reviewedBy) unreviewedWeeks.push(week);
    const reasons = reportHealthReasons(report);
    if (reasons.length) healthFlags.push({ weekNumber: week, reasons });
  }

  return {
    required,
    submitted: required - missingWeeks.length,
    missingWeeks,
    overdueWeeks,
    unreviewedWeeks,
    healthFlags,
  };
}

/**
 * Which end-date alert applies right now? Only the most severe applicable
 * stage is returned, so a job that was down for a few days does not send a
 * stale "ending soon" notice for a placement that is already overdue.
 */
function endDateAlertStage(expectedEndDate, now = new Date()) {
  if (!expectedEndDate) return null;
  const msLeft = new Date(expectedEndDate).getTime() - now.getTime();
  if (msLeft < 0) {
    const daysOverdue = Math.floor(-msLeft / DAY_MS);
    if (daysOverdue >= 7) return { stage: "overdue_7d", daysOverdue, escalate: true };
    if (daysOverdue >= 3) return { stage: "overdue_3d", daysOverdue, escalate: true };
    return { stage: "overdue", daysOverdue, escalate: false };
  }
  const daysLeft = Math.ceil(msLeft / DAY_MS);
  if (daysLeft <= 1) return { stage: "ending_1d", daysLeft, escalate: false };
  if (daysLeft <= 7) return { stage: "ending_7d", daysLeft, escalate: false };
  return null;
}

module.exports = {
  MIN_EXTENSION_DAYS,
  MAX_EXTENSION_DAYS,
  COMPLETION_OUTCOMES,
  validateExtensionDays,
  reportHealthReasons,
  evaluateReports,
  endDateAlertStage,
};
