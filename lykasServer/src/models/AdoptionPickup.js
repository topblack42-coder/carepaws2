const mongoose = require("mongoose");

// The scheduled handover of an approved pet to its adopter.
const adoptionPickupSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: "Application", required: true, index: true },
    applicant: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    pet: { type: mongoose.Schema.Types.ObjectId, ref: "Pet", required: true },
    scheduledDate: { type: Date, required: true },
    method: { type: String, enum: ["Shelter pickup", "Home delivery"], required: true },
    // Required for home delivery; for shelter pickup it defaults to "the shelter".
    location: { type: String },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["scheduled", "completed", "cancelled", "no-show"], default: "scheduled", index: true },
    notes: { type: String },
    cancelReason: { type: String },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdoptionPickup", adoptionPickupSchema);
