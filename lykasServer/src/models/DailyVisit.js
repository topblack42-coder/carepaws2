const mongoose = require("mongoose");

// One row per member per day they used the app — the source for the admin
// dashboard's visitor counter. "day" is a Manila-time YYYY-MM-DD string.
const dailyVisitSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

dailyVisitSchema.index({ user: 1, day: 1 }, { unique: true });
dailyVisitSchema.index({ day: 1 });
// Keep roughly 13 months of history.
dailyVisitSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 400 });

module.exports = mongoose.model("DailyVisit", dailyVisitSchema);
