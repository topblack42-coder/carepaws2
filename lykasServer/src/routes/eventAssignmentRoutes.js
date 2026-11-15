const express = require("express");
const router = express.Router();
const { EventVolunteerAssignment } = require("../models/Event");
const Volunteer = require("../models/Volunteer");
const { protect, adminOnly } = require("../middleware/authMiddleware");

// GET /api/event-assignments/my — the current user's own volunteer assignments across all events
router.get("/my", protect, async (req, res, next) => {
  try {
    const volunteer = await Volunteer.findOne({ user: req.user._id });
    if (!volunteer) return res.json({ success: true, data: [] });

    const data = await EventVolunteerAssignment.find({ volunteer: volunteer._id }).populate("event").sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post("/", protect, adminOnly, async (req, res, next) => {
  try {
    const assignment = await EventVolunteerAssignment.create({ ...req.body, assignedBy: req.user._id });
    res.status(201).json({ success: true, data: assignment });
  } catch (err) {
    next(err);
  }
});

router.get("/", protect, adminOnly, async (req, res, next) => {
  try {
    const data = await EventVolunteerAssignment.find().populate("event volunteer").sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const assignment = await EventVolunteerAssignment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!assignment) return res.status(404).json({ success: false, message: "Assignment not found" });
    res.json({ success: true, data: assignment });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/confirm", protect, async (req, res, next) => {
  try {
    const assignment = await EventVolunteerAssignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ success: false, message: "Assignment not found" });
    // Only the assigned volunteer (or staff) may confirm an assignment.
    const isStaff = ["staff", "admin", "super_admin"].includes(req.user.role);
    if (!isStaff) {
      const volunteer = await Volunteer.findOne({ user: req.user._id }).select("_id");
      if (!volunteer || String(volunteer._id) !== String(assignment.volunteer)) {
        return res.status(403).json({ success: false, message: "Not authorized to confirm this assignment" });
      }
    }
    assignment.status = "confirmed";
    await assignment.save();
    res.json({ success: true, data: assignment });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const assignment = await EventVolunteerAssignment.findByIdAndDelete(req.params.id);
    if (!assignment) return res.status(404).json({ success: false, message: "Assignment not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
