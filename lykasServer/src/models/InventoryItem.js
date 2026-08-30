const mongoose = require("mongoose");

const movementSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["restock", "usage", "adjustment"], required: true },
    quantity: { type: Number, required: true },
    note: { type: String },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sourceType: { type: String, enum: ["manual", "inkind_donation"], default: "manual" },
    sourceId: { type: mongoose.Schema.Types.ObjectId, ref: "InKindDonation", default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const inventoryItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    normalizedName: { type: String, index: true, sparse: true },
    category: { type: String, enum: ["food", "medical", "bedding", "cleaning", "equipment", "office", "other"], required: true },
    quantity: { type: Number, default: 0, min: 0 },
    unit: { type: String },
    minThreshold: { type: Number, default: 0, min: 0 },
    location: { type: String },
    supplier: { type: String },
    notes: { type: String },
    lastRestockedAt: { type: Date, default: null },
    lastRestockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    movements: [movementSchema],
  },
  { timestamps: true }
);

// Mongoose 9 dropped support for the next()-callback style entirely — a
// pre hook now just runs (sync or async) and finishes on its own; there
// is no next argument to call. The old `function (next) { ...; next(); }`
// form here threw "next is not a function" on every save, because v9
// simply never passes anything into that parameter.
inventoryItemSchema.pre("validate", function () {
  if (this.name) this.normalizedName = this.name.trim().toLowerCase();
});

module.exports = mongoose.model("InventoryItem", inventoryItemSchema);