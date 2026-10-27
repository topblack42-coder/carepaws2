const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
  {
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    type: { type: String, enum: ["general", "complaint", "review", "suggestion"], required: true },
    rating: { type: Number, min: 1, max: 5 },
    subject: { type: String },
    message: { type: String, required: true },
    relatedPet: { type: mongoose.Schema.Types.ObjectId, ref: "Pet" },
    // Set when the review is left for a completed adoption (one per application).
    application: { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
    status: { type: String, enum: ["new", "in_review", "responded", "resolved", "archived"], default: "new" },
    isPublic: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
    adminResponse: { type: String },
    respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

feedbackSchema.index({ application: 1, submittedBy: 1 }, { unique: true, partialFilterExpression: { application: { $exists: true } } });

module.exports = mongoose.model("Feedback", feedbackSchema);
