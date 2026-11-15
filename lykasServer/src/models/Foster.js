const mongoose = require("mongoose");

// Structured record of why a foster period was extended and who agreed.
const extensionSchema = new mongoose.Schema(
  {
    days: { type: Number, required: true },
    reason: { type: String, required: true },
    recommendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    vetAgreed: { type: Boolean, required: true },
    vetNotes: { type: String },
    fostererAgreed: { type: Boolean, required: true },
    authorizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorizedAt: { type: Date, default: Date.now },
    previousEndDate: { type: Date, required: true },
    newEndDate: { type: Date, required: true },
  },
  { _id: true }
);

const fosterSchema = new mongoose.Schema(
  {
    pet: { type: mongoose.Schema.Types.ObjectId, ref: "Pet", required: true, index: true },
    fosterer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    application: { type: mongoose.Schema.Types.ObjectId, ref: "Application", required: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    expectedEndDate: { type: Date },
    trialDurationDays: { type: Number },
    // Days added by staff after the original 30-60 day trial (total capped, see fosterController).
    extendedDays: { type: Number, default: 0 },
    weeklyReportsRequired: { type: Number, default: 0 },
    weeklyReportsSubmitted: { type: Number, default: 0 },
    // How a completed placement ended. An extension is not an outcome: the
    // placement stays active and the extension is recorded in `extensions`.
    outcome: { type: String, enum: ["ADOPTED", "RETURNED", null], default: null },
    extensions: { type: [extensionSchema], default: [] },
    // Staff check done at the end of the placement. Weekly reports are the
    // fosterer's own account and are not proof the animal is healthy.
    finalHealthCheck: {
      notes: { type: String },
      vetVerified: { type: Boolean },
      checkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      checkedAt: { type: Date },
    },
    // Set when an admin lets a placement close with reports missing or unreviewed.
    completionException: {
      reason: { type: String },
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      at: { type: Date },
      missingWeeks: { type: [Number], default: undefined },
      unreviewedWeeks: { type: [Number], default: undefined },
    },
    // Who to call if the fosterer cannot be reached.
    emergencyContact: {
      name: { type: String },
      phone: { type: String },
      relationship: { type: String },
    },
    // Early or emergency return asked for by the fosterer or staff.
    returnRequest: {
      urgency: { type: String, enum: ["routine", "emergency"] },
      reason: { type: String },
      status: { type: String, enum: ["open", "resolved"] },
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      requestedAt: { type: Date },
      resolvedAt: { type: Date },
    },
    // Last end-date alert sent (see runFosterEndDateAlerts), so the admin list can show it.
    endAlertStage: { type: String, default: null },
    staffNotes: { type: String },
    closedAt: { type: Date, default: null },
    status: { type: String, enum: ["active", "completed", "cancelled"], default: "active" },
    fosterAgreementSigned: { type: Boolean, default: false },
    pickupNotes: { type: String },
    returnNotes: { type: String },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notes: { type: String },
  },
  { timestamps: true }
);

fosterSchema.index({ application: 1 }, { unique: true, partialFilterExpression: { application: { $exists: true } } });

const weeklyFosterReportSchema = new mongoose.Schema(
  {
    foster: { type: mongoose.Schema.Types.ObjectId, ref: "Foster", required: true, index: true },
    pet: { type: mongoose.Schema.Types.ObjectId, ref: "Pet", required: true },
    fosterer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    weekNumber: { type: Number, required: true },
    dueDate: { type: Date, default: null },
    reportDate: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["missing", "overdue", "submitted"],
      default: "submitted",
      index: true,
    },
    weightChange: { type: Number },
    appetite: { type: String, enum: ["Excellent", "Good", "Fair", "Poor"] },
    energy: { type: String, enum: ["Very Active", "Active", "Low", "Lethargic"] },
    behavior: { type: String },
    healthConcerns: { type: String },
    vetVisitRequired: { type: Boolean, default: false },
    overallProgress: { type: String, enum: ["Excellent", "Good", "Fair", "Needs Attention"] },
    notes: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    adminNotes: { type: String },
  },
  { timestamps: true }
);

weeklyFosterReportSchema.index({ foster: 1, weekNumber: 1 }, { unique: true });

const Foster = mongoose.model("Foster", fosterSchema);
const WeeklyFosterReport = mongoose.model("WeeklyFosterReport", weeklyFosterReportSchema);

/**
 * A weekly report is due at the end of its week. The final report is due on
 * the trial end date when the trial is not an exact multiple of seven days.
 */
function getFosterReportDueDate(foster, weekNumber) {
  const startDate = new Date(foster.startDate);
  const trialEnd = new Date(
    foster.expectedEndDate ||
      (startDate.getTime() + Number(foster.trialDurationDays || 0) * 24 * 60 * 60 * 1000)
  );

  const weekOffsetDays = Math.min(
    Number(weekNumber) * 7,
    Math.max(0, Number(foster.trialDurationDays || 0))
  );
  const dueDate = new Date(startDate);
  dueDate.setDate(dueDate.getDate() + weekOffsetDays);

  return dueDate > trialEnd ? trialEnd : dueDate;
}

module.exports = { Foster, WeeklyFosterReport, getFosterReportDueDate };
