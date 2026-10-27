const express = require("express");
const router = express.Router();
const Pet = require("../models/Pet");
const Application = require("../models/Application");
const Volunteer = require("../models/Volunteer");
const Payment = require("../models/Payment");
const User = require("../models/User");
const DailyVisit = require("../models/DailyVisit");
const { dayKey } = require("../utils/visitTracker");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const { getSheltersWithOccupancy } = require("../utils/shelterOccupancy");

async function getVisitorStats() {
  const days = Array.from({ length: 7 }, (_, i) => dayKey(6 - i)); // oldest -> today
  const [perDay, last7, last30, totalMembers] = await Promise.all([
    DailyVisit.aggregate([{ $match: { day: { $in: days } } }, { $group: { _id: "$day", count: { $sum: 1 } } }]),
    DailyVisit.distinct("user", { day: { $gte: dayKey(6) } }),
    DailyVisit.distinct("user", { day: { $gte: dayKey(29) } }),
    User.countDocuments({ role: "user", isDeleted: { $ne: true } }),
  ]);
  const counts = new Map(perDay.map((d) => [d._id, d.count]));
  const daily = days.map((day) => ({ day, count: counts.get(day) || 0 }));
  return { today: daily[daily.length - 1].count, last7Days: last7.length, last30Days: last30.length, totalMembers, daily };
}

router.get("/", protect, adminOnly, async (req, res, next) => {
  try {
    const [petsByStatus, pendingApplications, pendingVolunteers, revenueThisMonth, shelters, visitors] = await Promise.all([
      Pet.aggregate([{ $match: { isDeleted: { $ne: true } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      Application.countDocuments({ status: "pending" }),
      Volunteer.countDocuments({ status: "pending" }),
      Payment.aggregate([
        { $match: { status: "paid", paidAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      getSheltersWithOccupancy(),
      getVisitorStats(),
    ]);

    res.json({
      success: true,
      data: {
        petsByStatus,
        pendingApplications,
        pendingVolunteers,
        revenueThisMonthCentavos: revenueThisMonth[0]?.total || 0,
        visitors,
        shelterStats: {
          count: shelters.length,
          totalCapacity: shelters.reduce((sum, shelter) => sum + shelter.capacity, 0),
          totalOccupancy: shelters.reduce((sum, shelter) => sum + shelter.currentOccupancy, 0),
          availableCapacity: shelters.reduce((sum, shelter) => sum + shelter.availableCapacity, 0),
          occupancyPercentage: (() => {
            const capacity = shelters.reduce((sum, shelter) => sum + shelter.capacity, 0);
            const occupancy = shelters.reduce((sum, shelter) => sum + shelter.currentOccupancy, 0);
            return capacity > 0 ? Math.round((occupancy / capacity) * 10000) / 100 : 0;
          })(),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
