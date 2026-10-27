const mongoose = require("mongoose");

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
    outcome: { type: String, enum: ["ADOPTED", "RETURNED", "EXTENDED", null], default: null },
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
