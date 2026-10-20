const express = require("express");
const router = express.Router();
const Appointment = require("../models/Appointment");
const { protect, adminOnly, requireVerifiedEmail } = require("../middleware/authMiddleware");
const validateRequest = require("../middleware/validateRequest");
const { appointmentCreateSchema, appointmentUpdateSchema, appointmentEnrollSchema } = require("../validators/appointment.schema");

const HOUR_MS = 60 * 60 * 1000;

function shiftEnd(appointment) {
  return new Date(new Date(appointment.date).getTime() + Number(appointment.durationHours || 0) * HOUR_MS);
}

function hasActiveRegistration(appointment, userId) {
  const id = String(userId);
  return (
    (appointment.registrations || []).some((r) => String(r.user) === id && r.status === "registered") ||
    (appointment.user && String(appointment.user) === id)
  );
}

function hasOverlap(candidate, existing) {
  const start = new Date(candidate.date).getTime();
  const end = start + Number(candidate.durationHours || 0) * HOUR_MS;
  const otherStart = new Date(existing.date).getTime();
  const otherEnd = otherStart + Number(existing.durationHours || 0) * HOUR_MS;
  // Strict inequalities intentionally allow adjacent shifts:
  // 08:00-10:00 and 10:00-12:00.
  return start < otherEnd && otherStart < end;
}

async function findVolunteerOverlap(userId, candidate, excludeId) {
  const filter = {
    status: { $ne: "Completed" },
    $or: [
      { user: userId },
      { registrations: { $elemMatch: { user: userId, status: "registered" } } },
    ],
  };
  if (excludeId) filter._id = { $ne: excludeId };

  const appointments = await Appointment.find(filter).select("date durationHours user registrations");
  return appointments.find((appointment) => hasOverlap(candidate, appointment));
}

router.get("/", async (req, res, next) => {
  try {
    const appointments = await Appointment.find({ status: { $ne: "Completed" } }).sort({ date: 1 });
    res.json({ success: true, data: appointments });
  } catch (err) {
    next(err);
  }
});

router.post("/", protect, adminOnly, validateRequest(appointmentCreateSchema), async (req, res, next) => {
  try {
    const date = new Date(req.body.date);
    if (Number.isNaN(date.getTime())) return res.status(400).json({ success: false, message: "Invalid shift date" });

    const appointment = await Appointment.create({ ...req.body, date });
    res.status(201).json({ success: true, data: appointment });
  } catch (err) {
    next(err);
  }
});

router.get("/my-appointments", protect, async (req, res, next) => {
  try {
    const appointments = await Appointment.find({
      $or: [
        { user: req.user._id },
        { registrations: { $elemMatch: { user: req.user._id, status: "registered" } } },
      ],
    }).sort({ date: 1 });

    const data = appointments.map((appointment) => {
      const item = appointment.toObject();
      const registration = (item.registrations || []).find(
        (r) => String(r.user) === String(req.user._id) && r.status === "registered"
      );
      // Keep the existing mobile client contract while the database stores
      // multiple registrations per shift.
      if (registration) {
        item.user = req.user._id;
        item.phone = registration.phone;
        item.emergencyContact = registration.emergencyContact;
        item.notes = registration.notes;
        item.appliedAt = registration.appliedAt;
      }
      delete item.registrations;
      return item;
    });

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/enroll", protect, requireVerifiedEmail, validateRequest(appointmentEnrollSchema), async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found" });
    if (appointment.status === "Completed") return res.status(409).json({ success: false, message: "Shift is already completed" });
    if (hasActiveRegistration(appointment, req.user._id)) {
      return res.status(409).json({ success: false, message: "You are already enrolled in this shift" });
    }

    const overlap = await findVolunteerOverlap(req.user._id, appointment);
    if (overlap) {
      return res.status(409).json({
        success: false,
        message: `Shift overlaps with "${overlap.title}" (${new Date(overlap.date).toLocaleString()}–${shiftEnd(overlap).toLocaleString()})`,
        code: "SHIFT_CONFLICT",
      });
    }

    // Re-check capacity at write time so two simultaneous enrollments cannot
    // both consume the final slot.
    const registeredCount = (appointment.registrations || []).filter((r) => r.status === "registered").length;
    const legacyCount = appointment.user && !(appointment.registrations || []).some((r) => String(r.user) === String(appointment.user)) ? 1 : 0;
    const currentCount = registeredCount + legacyCount;
    if (currentCount >= appointment.capacity) {
      await Appointment.updateOne({ _id: appointment._id }, { $set: { status: "Full" } });
      return res.status(409).json({ success: false, message: "Shift is full" });
    }

    const registration = {
      user: req.user._id,
      phone: req.body.phone,
      emergencyContact: req.body.emergencyContact,
      notes: req.body.notes,
      appliedAt: new Date(),
      status: "registered",
    };

    const updated = await Appointment.findOneAndUpdate(
      {
        _id: appointment._id,
        status: { $ne: "Completed" },
        user: { $ne: req.user._id },
        registrations: { $not: { $elemMatch: { user: req.user._id, status: "registered" } } },
        $expr: {
          $lt: [
            {
              $cond: [
                { $gt: [{ $size: "$registrations" }, 0] },
                { $size: { $filter: { input: "$registrations", as: "r", cond: { $eq: ["$$r.status", "registered"] } } } },
                { $cond: [{ $ne: ["$user", null] }, 1, 0] },
              ],
            },
            "$capacity",
          ],
        },
      },
      { $push: { registrations: registration } },
      { new: true }
    );

    if (!updated) {
      return res.status(409).json({ success: false, message: "Shift is full or no longer available" });
    }

    const updatedCount = (updated.registrations || []).filter((r) => r.status === "registered").length +
      (updated.user ? 1 : 0);
    if (updatedCount >= updated.capacity && updated.status !== "Completed") {
      updated.status = "Full";
    } else if (updated.status === "Full") {
      updated.status = "Open";
    }
    await updated.save();

    res.status(201).json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/cancel", protect, async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found" });

    const registration = (appointment.registrations || []).find(
      (r) => String(r.user) === String(req.user._id) && r.status === "registered"
    );

    if (registration) {
      registration.status = "cancelled";
      await appointment.save();
      if (appointment.status === "Full") {
        appointment.status = "Open";
        await appointment.save();
      }
      return res.json({ success: true, data: appointment });
    }

    // Backward-compatible cancellation for legacy single-user appointments.
    if (appointment.user && String(appointment.user) === String(req.user._id)) {
      appointment.user = null;
      appointment.phone = undefined;
      appointment.emergencyContact = undefined;
      appointment.appliedAt = null;
      appointment.status = "Open";
      await appointment.save();
      return res.json({ success: true, data: appointment });
    }

    return res.status(404).json({ success: false, message: "You are not enrolled in this shift" });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", protect, adminOnly, validateRequest(appointmentUpdateSchema), async (req, res, next) => {
  try {
    const existing = await Appointment.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Appointment not found" });

    const candidate = {
      date: req.body.date ? new Date(req.body.date) : existing.date,
      durationHours: req.body.durationHours ?? existing.durationHours,
    };

    if (req.body.date && Number.isNaN(candidate.date.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid shift date" });
    }

    const newCapacity = req.body.capacity ?? existing.capacity;
    const activeCount = (existing.registrations || []).filter((r) => r.status === "registered").length +
      (existing.user && !(existing.registrations || []).some((r) => String(r.user) === String(existing.user)) ? 1 : 0);
    if (newCapacity < activeCount) {
      return res.status(409).json({ success: false, message: "Capacity cannot be below current registrations" });
    }

    // A shift may be edited while assigned; validate the new interval against
    // every currently enrolled volunteer.
    const enrolledIds = [
      ...(existing.registrations || []).filter((r) => r.status === "registered").map((r) => r.user),
      ...(existing.user ? [existing.user] : []),
    ];
    for (const userId of enrolledIds) {
      const conflict = await findVolunteerOverlap(userId, candidate, existing._id);
      if (conflict) {
        return res.status(409).json({
          success: false,
          message: `Updated shift overlaps with "${conflict.title}" for an enrolled volunteer`,
          code: "SHIFT_CONFLICT",
        });
      }
    }

    const appointment = await Appointment.findByIdAndUpdate(
      req.params.id,
      { $set: { ...req.body, date: candidate.date, status: activeCount >= newCapacity ? "Full" : (req.body.status || "Open") } },
      { new: true, runValidators: true }
    );
    res.json({ success: true, data: appointment });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const appointment = await Appointment.findByIdAndDelete(req.params.id);
    if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
