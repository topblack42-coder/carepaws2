const mongoose = require("mongoose");

// Optional introduction video. The binary lives in Cloudinary; only the
// reference and metadata are stored here. `video` defaults to null, so
// pets created before this field existed read back as `video: null` and
// need no migration.
const petVideoSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    thumbnailUrl: { type: String, default: null },
    publicId: { type: String, required: true },
    duration: { type: Number, default: null },
    mimeType: { type: String, default: "video/mp4" },
    size: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const petSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    species: { type: String, enum: ["Dog", "Cat", "Other"], required: true },
    breed: { type: String, default: "" },
    age: { type: Number },
    gender: { type: String, enum: ["Male", "Female"] },
    size: { type: String, enum: ["Small", "Medium", "Large"] },
    weight: { type: Number },
    temperament: {
      type: String,
      enum: ["Calm", "Playful", "Shy", "Energetic", "Affectionate", "Independent", null],
    },
    energyLevel: { type: String, enum: ["Low", "Medium", "High"] },
    healthStatus: { type: String, default: "" },
    description: { type: String, default: "" },
    imageUrl: { type: String, default: null },
    video: { type: petVideoSchema, default: null },
    status: {
      type: String,
      enum: ["Available", "Pending", "Adopted", "Foster"],
      default: "Available",
      index: true,
    },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    shelterId: { type: mongoose.Schema.Types.ObjectId, ref: "Shelter", default: null, index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

petSchema.index({ status: 1, species: 1 });
petSchema.index({ name: "text", breed: "text", description: "text" });

module.exports = mongoose.model("Pet", petSchema);
