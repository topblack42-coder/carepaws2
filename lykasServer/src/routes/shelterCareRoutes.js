const express = require("express");
const router = express.Router();
const { HealthCheck, FeedingLog, BehavioralObservation, CageAssignment, QuarantinePeriod } = require("../models/ShelterCare");
const Cage = require("../models/Cage");
const Shelter = require("../models/Shelter");
const Pet = require("../models/Pet");
const { getCagesWithOccupancy, assertCageAssignmentAllowed, getEligiblePetsForCage } = require("../utils/cageManagement");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const validateRequest = require("../middleware/validateRequest");
const {
  healthCheckSchema,
  feedingLogSchema,
  behavioralObsSchema,
  cageAssignmentSchema,
  quarantineSchema,
} = require("../validators/shelterCare.schema");
const { cageCreateSchema, cageUpdateSchema } = require("../validators/cage.schema");

// GET /api/shelter-care/summary/:petId — a rollup across all five sub-concerns
router.get("/summary/:petId", protect, adminOnly, async (req, res, next) => {
  try {
    const { petId } = req.params;
    const [latestHealth, latestFeeding, latestBehavior, activeCage, activeQuarantine] = await Promise.all([
      HealthCheck.findOne({ pet: petId }).sort({ date: -1 }),
      FeedingLog.findOne({ pet: petId }).sort({ date: -1 }),
      BehavioralObservation.findOne({ pet: petId }).sort({ date: -1 }),
      CageAssignment.findOne({ pet: petId, isActive: true }),
      QuarantinePeriod.findOne({ pet: petId, isActive: true }),
    ]);
    res.json({ success: true, data: { latestHealth, latestFeeding, latestBehavior, activeCage, activeQuarantine } });
  } catch (err) {
    next(err);
  }
});

// --- Health checks ---
router.post("/health-checks", protect, adminOnly, validateRequest(healthCheckSchema), async (req, res, next) => {
  try {
    const doc = await HealthCheck.create({ ...req.body, checkedBy: req.user._id });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
});
router.get("/health-checks/flagged", protect, adminOnly, async (req, res, next) => {
  try {
    const docs = await HealthCheck.find({ flagged: true }).populate("pet").sort({ date: -1 });
    res.json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
});
router.get("/health-checks/:petId", protect, adminOnly, async (req, res, next) => {
  try {
    const docs = await HealthCheck.find({ pet: req.params.petId }).sort({ date: -1 });
    res.json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
});

// --- Feeding logs ---
router.post("/feeding-logs", protect, adminOnly, validateRequest(feedingLogSchema), async (req, res, next) => {
  try {
    const doc = await FeedingLog.create({ ...req.body, loggedBy: req.user._id });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
});
router.get("/feeding-logs/:petId", protect, adminOnly, async (req, res, next) => {
  try {
    const docs = await FeedingLog.find({ pet: req.params.petId }).sort({ date: -1 });
    res.json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
});

// --- Behavioral observations ---
router.post("/behavioral-obs", protect, adminOnly, validateRequest(behavioralObsSchema), async (req, res, next) => {
  try {
    const doc = await BehavioralObservation.create({ ...req.body, observedBy: req.user._id });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
});
router.get("/behavioral-obs/:petId", protect, adminOnly, async (req, res, next) => {
  try {
    const docs = await BehavioralObservation.find({ pet: req.params.petId }).sort({ date: -1 });
    res.json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
});

// --- Cage definitions ---
router.post("/cage-definitions", protect, adminOnly, validateRequest(cageCreateSchema), async (req, res, next) => {
  try {
    const shelter = await Shelter.findById(req.body.shelterId);
    if (!shelter) return res.status(404).json({ success: false, message: "Shelter not found" });
    if (shelter.status === "inactive" || shelter.status === "under_maintenance") {
      return res.status(409).json({ success: false, message: "Cannot create cages in an inactive or unavailable shelter" });
    }
    const cage = await Cage.create({ ...req.body, createdBy: req.user._id });
    const data = (await getCagesWithOccupancy({ _id: cage._id }))[0];
    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ success: false, message: "Cage number already exists in this shelter" });
    next(err);
  }
});

router.get("/cage-definitions", protect, adminOnly, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.shelterId) filter.shelterId = req.query.shelterId;
    const cages = await getCagesWithOccupancy(filter);
    if (req.query.petId) {
      const pet = await Pet.findById(req.query.petId);
      if (!pet) return res.status(404).json({ success: false, message: "Pet not found" });
      const quarantine = await QuarantinePeriod.findOne({ pet: pet._id, isActive: true });
      const eligible = cages.filter((cage) =>
        String(cage.shelterId?._id || cage.shelterId) === String(pet.shelterId) &&
        cage.status === "active" &&
        cage.currentOccupancy < cage.capacity &&
        cage.allowedSpecies.includes(pet.species) &&
        cage.quarantineOnly === Boolean(quarantine)
      );
      return res.json({ success: true, data: eligible });
    }
    res.json({ success: true, data: cages });
  } catch (err) {
    next(err);
  }
});

router.get("/cage-definitions/:id/eligible-pets", protect, adminOnly, async (req, res, next) => {
  try {
    const pets = await getEligiblePetsForCage(req.params.id);
    res.json({ success: true, data: pets });
  } catch (err) {
    next(err);
  }
});

router.put("/cage-definitions/:id", protect, adminOnly, validateRequest(cageUpdateSchema), async (req, res, next) => {
  try {
    const cage = await Cage.findById(req.params.id);
    if (!cage) return res.status(404).json({ success: false, message: "Cage not found" });
    const activeAssignments = await CageAssignment.countDocuments({ cageId: cage._id, isActive: true });
    if (req.body.capacity !== undefined && req.body.capacity < activeAssignments) {
      return res.status(409).json({ success: false, message: `Capacity cannot be lower than current occupancy (${activeAssignments})` });
    }
    if (req.body.status && req.body.status !== "active" && activeAssignments > 0) {
      return res.status(409).json({ success: false, message: "Empty the cage before making it unavailable" });
    }
    if (req.body.quarantineOnly !== undefined && activeAssignments > 0) {
      return res.status(409).json({ success: false, message: "Empty the cage before changing quarantine-only status" });
    }
    Object.assign(cage, req.body);
    await cage.save();
    const data = (await getCagesWithOccupancy({ _id: cage._id }))[0];
    res.json({ success: true, data });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ success: false, message: "Cage number already exists in this shelter" });
    next(err);
  }
});

// --- Cage assignments ---
router.post("/cages", protect, adminOnly, validateRequest(cageAssignmentSchema), async (req, res, next) => {
  try {
    let cageId = req.body.cageId;
    if (!cageId) {
      const pet = await Pet.findById(req.body.pet);
      if (!pet?.shelterId) return res.status(409).json({ success: false, message: "Pet must be assigned to a shelter before cage assignment" });
      const cage = await Cage.findOne({ shelterId: pet.shelterId, cageNumber: req.body.cageNumber });
      if (!cage) return res.status(404).json({ success: false, message: "Cage not found in the pet's shelter" });
      cageId = cage._id;
    }
    const { cage, pet } = await assertCageAssignmentAllowed(cageId, req.body.pet);
    const doc = await CageAssignment.create({
      ...req.body,
      cageId: cage._id,
      cageNumber: cage.cageNumber,
      section: cage.section,
      assignedBy: req.user._id,
    });
    await doc.populate("pet");
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ success: false, message: "Pet already has an active cage assignment" });
    next(err);
  }
});
router.get("/cages", protect, adminOnly, async (req, res, next) => {
  try {
    const docs = await CageAssignment.find({ isActive: true }).populate("pet").populate("cageId");
    res.json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
});
router.get("/cages/:petId", protect, adminOnly, async (req, res, next) => {
  try {
    const docs = await CageAssignment.find({ pet: req.params.petId }).sort({ assignedAt: -1 });
    res.json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
});
router.delete("/cages/:assignmentId", protect, adminOnly, async (req, res, next) => {
  try {
    const doc = await CageAssignment.findByIdAndUpdate(req.params.assignmentId, { isActive: false, releasedAt: new Date() }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "Cage assignment not found" });
    res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
});

// --- Quarantine periods ---
router.post("/quarantine", protect, adminOnly, validateRequest(quarantineSchema), async (req, res, next) => {
  try {
    const existing = await QuarantinePeriod.findOne({ pet: req.body.pet, isActive: true });
    if (existing) return res.status(409).json({ success: false, message: "Pet is already in quarantine" });

    const activeAssignment = await CageAssignment.findOne({ pet: req.body.pet, isActive: true }).populate("cageId");
    if (activeAssignment) {
      if (activeAssignment.cageId?.quarantineOnly) {
        return res.status(409).json({ success: false, message: "Pet is already assigned to a quarantine cage" });
      }
      activeAssignment.isActive = false;
      activeAssignment.releasedAt = new Date();
      await activeAssignment.save();
    }

    const doc = await QuarantinePeriod.create({ ...req.body, startedBy: req.user._id });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
});
router.get("/quarantine", protect, adminOnly, async (req, res, next) => {
  try {
    const docs = await QuarantinePeriod.find({ isActive: true }).populate("pet");
    res.json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
});
router.get("/quarantine/:petId", protect, adminOnly, async (req, res, next) => {
  try {
    const docs = await QuarantinePeriod.find({ pet: req.params.petId }).sort({ startDate: -1 });
    res.json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
});
router.put("/quarantine/:id/end", protect, adminOnly, async (req, res, next) => {
  try {
    const quarantine = await QuarantinePeriod.findById(req.params.id);
    if (!quarantine) return res.status(404).json({ success: false, message: "Quarantine period not found" });
    if (!quarantine.isActive) return res.status(409).json({ success: false, message: "Quarantine period is already ended" });

    const activeAssignment = await CageAssignment.findOne({ pet: quarantine.pet, isActive: true }).populate("cageId");
    if (activeAssignment?.cageId?.quarantineOnly) {
      activeAssignment.isActive = false;
      activeAssignment.releasedAt = new Date();
      await activeAssignment.save();
    }

    quarantine.isActive = false;
    quarantine.endDate = new Date();
    quarantine.endedBy = req.user._id;
    await quarantine.save();
    res.json({ success: true, data: quarantine });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
