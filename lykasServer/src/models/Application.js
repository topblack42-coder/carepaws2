const mongoose = require("mongoose");

const stageHistoryEntrySchema = new mongoose.Schema(
  {
    stage: { type: String, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedAt: { type: Date, default: Date.now },
    note: { type: String },
  },
  { _id: false }
);

const internalNoteSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const applicationSchema = new mongoose.Schema(
  {
    pet: { type: mongoose.Schema.Types.ObjectId, ref: "Pet", required: true, index: true },
    applicant: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    phone: { type: String },
    address: { type: String },
    experience: { type: String },
    householdSize: { type: Number },
    isRenting: { type: Boolean, default: false },
    landlordApproval: { type: Boolean, default: false },
    type: { type: String, enum: ["adoption", "foster"], default: "adoption", index: true },
    fosterPeriod: { type: String },
    // Days the applicant offered to foster (30/45/60 in the app); staff use it to prefill the placement.
    fosterDays: { type: Number, min: 30, max: 60 },
    // When/how the applicant would like to receive the pet. A request only: staff schedule the actual pickup.
    preferredPickupDate: { type: Date },
    preferredPickupMethod: { type: String, enum: ["Shelter pickup", "Home delivery"] },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    stage: {
      type: String,
      enum: [
        "submitted",
        "document_review",
        "interview",
        "home_visit",
        "risk_assessment",
        "approved",
        "adoption_scheduled",
        "completed",
        "rejected",
      ],
      default: "submitted",
      index: true,
    },
    stageHistory: [stageHistoryEntrySchema],
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    internalNotes: [internalNoteSchema],
  },
  { timestamps: true }
);

applicationSchema.index({ pet: 1, applicant: 1, status: 1 });
// Only one live application may control a pet at a time. Rejected applications
// remain as history and therefore do not block a later application.
applicationSchema.index(
  { pet: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["pending", "approved"] } } }
);

module.exports = mongoose.model("Application", applicationSchema);
