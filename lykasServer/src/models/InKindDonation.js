const mongoose = require("mongoose");

const donatedItemSchema = new mongoose.Schema(
  { name: String, quantity: Number, unit: String },
  { _id: false }
);

const inKindDonationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    quantity: { type: Number },
    unit: { type: String },
    donatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    items: [donatedItemSchema],
    dropOff: { type: String, enum: ["walk_in", "schedule", "courier"], required: true },
    notes: { type: String },
    // Where the shelter should collect the goods (schedule / courier drop-offs).
    pickupAddress: { type: String, trim: true },
    photos: [{ type: String }],
    // Consent record (Privacy Policy + User Agreement) captured with the donation.
    privacyAccepted: { type: Boolean, default: false },
    privacyAcceptedAt: { type: Date, default: null },
    privacyPolicyVersion: { type: String, default: null },
    status: { type: String, enum: ["pending", "confirmed", "received", "cancelled"], default: "pending" },
    staffNote: { type: String },
    receivedAt: { type: Date, default: null },
    inventoryProcessedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InKindDonation", inKindDonationSchema);
