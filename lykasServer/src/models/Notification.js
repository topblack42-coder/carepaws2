const mongoose = require("mongoose");

const NOTIFICATION_TYPES = [
  "APPLICATION_SUBMITTED", "APPLICATION_STATUS_CHANGED", "RISK_ASSESSMENT_COMPLETED", "APPLICATION_APPROVED", "APPLICATION_REJECTED", "APPLICATION_CANCELLED", "FOSTER_APPROVED",
  "INTERVIEW_SCHEDULED", "INTERVIEW_RESCHEDULED", "INTERVIEW_CANCELLED", "INTERVIEW_RESULT",
  "HOME_VISIT_SCHEDULED", "HOME_VISIT_RESCHEDULED", "HOME_VISIT_CANCELLED", "HOME_VISIT_RESULT",
  "FOSTER_STARTED", "FOSTER_ENDED", "FOSTER_REPORT_DUE", "FOSTER_REPORT_REVIEWED",
  "MONITORING_REPORT_DUE", "MONITORING_REPORT_REVIEWED", "MONITORING_REPORT_FLAGGED", "MONITORING_REMINDER",
  "EVENT_CREATED", "EVENT_REMINDER", "EVENT_CANCELLED", "EVENT_REGISTRATION", "VOLUNTEER_SHIFT", "EMERGENCY_REPORT_UPDATE", "CHAT_MESSAGE",
  "VACCINATION_DUE", "HEALTH_CHECK_FLAGGED",
  "IN_KIND_DONATION_STATUS", "PAYMENT_PENDING", "PAYMENT_RECEIVED", "PAYMENT_FAILED", "PAYMENT_REFUNDED", "PAYMENT_CANCELLED",
  "GENERAL",
];

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    refModel: {
      type: String,
      enum: ["Application", "Interview", "HomeVisit", "Foster", "MonitoringReport", "Event", "Pet", "Payment", "InKindDonation", "EmergencyReport", null],
      default: null,
    },
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },
    isRead: { type: Boolean, default: false },
    // No `default: null` here on purpose: this field is only ever set by
    // notifyOnce() callers that want idempotency (payments, reminders,
    // chat messages, etc.). Every one of those passes its own unique
    // string. The one caller that doesn't — the admin "send a
    // notification" feature, via notify() directly — must NOT get an
    // explicit null written here, because the index below is
    // { unique: true, sparse: true }, and a sparse index only skips
    // documents where the field is completely absent, not documents
    // where it's present with value null. With a null default, every
    // such notification wrote dedupeKey: null, so only the very first
    // one ever created could succeed — every one after it hit
    // E11000 duplicate key on dedupeKey_1. Leaving the field genuinely
    // unset (no default at all) is what makes "sparse" work as intended.
    dedupeKey: { type: String },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Notification", notificationSchema);
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;