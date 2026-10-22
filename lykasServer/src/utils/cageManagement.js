const Cage = require("../models/Cage");
const Pet = require("../models/Pet");
const { CageAssignment, QuarantinePeriod } = require("../models/ShelterCare");
const Shelter = require("../models/Shelter");

function cageError(message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getCageOccupancy(cageId) {
  return CageAssignment.countDocuments({ cageId, isActive: true });
}

async function getCagesWithOccupancy(filter = {}) {
  const cages = await Cage.find(filter).populate("shelterId", "name status").sort({ shelterId: 1, cageNumber: 1 }).lean();
  if (!cages.length) return [];

  const rows = await CageAssignment.aggregate([
    { $match: { isActive: true, cageId: { $ne: null } } },
    { $group: { _id: "$cageId", count: { $sum: 1 } } },
  ]);
  const occupancy = new Map(rows.map((row) => [String(row._id), row.count]));

  return cages.map((cage) => {
    const currentOccupancy = occupancy.get(String(cage._id)) || 0;
    return {
      ...cage,
      currentOccupancy,
      availableCapacity: Math.max(0, cage.capacity - currentOccupancy),
      isEmpty: currentOccupancy === 0,
      availability: cage.status === "active" && currentOccupancy < cage.capacity ? "available" : "unavailable",
    };
  });
}

/**
 * The single source of truth for cage assignment rules. Pure: takes already
 * loaded data and returns the first rule violated as { message, statusCode },
 * or null when the pet may go in the cage. Used by assertCageAssignmentAllowed
 * (single pet, throws) and getEligiblePetsForCage (many pets, filters).
 */
function getCageAssignmentBlocker({ cage, pet, shelter, hasActiveAssignment, isQuarantined, occupancy, occupantSpecies }) {
  const blocked = (message, statusCode = 409) => ({ message, statusCode });

  if (!pet.shelterId) return blocked("Pet must be assigned to a shelter before cage assignment");
  if (String(pet.shelterId) !== String(cage.shelterId)) return blocked("Pet and cage must belong to the same shelter");
  if (cage.status !== "active") return blocked("Cannot assign a pet to an inactive or unavailable cage");
  if (hasActiveAssignment) return blocked("Pet already has an active cage assignment");

  if (isQuarantined !== Boolean(cage.quarantineOnly)) {
    if (isQuarantined) return blocked("Quarantined pets can only be assigned to quarantine cages");
    return blocked("Normal pets cannot be assigned to quarantine-only cages");
  }

  if (!cage.allowedSpecies.includes(pet.species)) return blocked(`Cage ${cage.cageNumber} does not accept ${pet.species} pets`);
  if (occupancy >= cage.capacity) return blocked("Cage is at capacity");
  if (occupantSpecies.some((species) => species && species !== pet.species)) {
    return blocked("Cage cannot contain incompatible pet species");
  }
  if (!shelter || shelter.status === "inactive" || shelter.status === "under_maintenance") {
    return blocked("Pets cannot be assigned in an inactive or unavailable shelter");
  }
  return null;
}

async function getCageOccupantSpecies(cageId) {
  const occupants = await CageAssignment.find({ cageId, isActive: true }).populate("pet", "species");
  return occupants.map((assignment) => assignment.pet?.species);
}

async function assertCageAssignmentAllowed(cageId, petId) {
  const [cage, pet] = await Promise.all([
    Cage.findById(cageId),
    Pet.findOne({ _id: petId, isDeleted: { $ne: true } }),
  ]);

  if (!cage) throw cageError("Cage not found", 404);
  if (!pet) throw cageError("Pet not found", 404);

  const [existingAssignment, quarantine, occupancy, occupantSpecies, shelter] = await Promise.all([
    CageAssignment.findOne({ pet: pet._id, isActive: true }),
    QuarantinePeriod.findOne({ pet: pet._id, isActive: true }),
    getCageOccupancy(cage._id),
    getCageOccupantSpecies(cage._id),
    Shelter.findById(cage.shelterId).select("status"),
  ]);

  const blocker = getCageAssignmentBlocker({
    cage,
    pet,
    shelter,
    hasActiveAssignment: Boolean(existingAssignment),
    isQuarantined: Boolean(quarantine),
    occupancy,
    occupantSpecies,
  });
  if (blocker) throw cageError(blocker.message, blocker.statusCode);

  return { cage, pet };
}

/**
 * Pets that could be assigned to the cage right now: same shelter, not already
 * caged, species accepted, quarantine status matching, and species-compatible
 * with current occupants. Applies the same rules as assertCageAssignmentAllowed.
 */
async function getEligiblePetsForCage(cageId) {
  const cage = await Cage.findById(cageId);
  if (!cage) throw cageError("Cage not found", 404);

  const [shelter, occupancy, occupantSpecies, candidates] = await Promise.all([
    Shelter.findById(cage.shelterId).select("status"),
    getCageOccupancy(cage._id),
    getCageOccupantSpecies(cage._id),
    Pet.find({ shelterId: cage.shelterId, isDeleted: { $ne: true } }).select("name species shelterId").sort({ name: 1 }),
  ]);
  if (!candidates.length) return [];

  const candidateIds = candidates.map((pet) => pet._id);
  const [caged, quarantined] = await Promise.all([
    CageAssignment.distinct("pet", { pet: { $in: candidateIds }, isActive: true }),
    QuarantinePeriod.distinct("pet", { pet: { $in: candidateIds }, isActive: true }),
  ]);
  const cagedIds = new Set(caged.map(String));
  const quarantinedIds = new Set(quarantined.map(String));

  return candidates.filter(
    (pet) =>
      !getCageAssignmentBlocker({
        cage,
        pet,
        shelter,
        hasActiveAssignment: cagedIds.has(String(pet._id)),
        isQuarantined: quarantinedIds.has(String(pet._id)),
        occupancy,
        occupantSpecies,
      })
  );
}

module.exports = {
  cageError,
  getCagesWithOccupancy,
  getCageOccupancy,
  getCageAssignmentBlocker,
  assertCageAssignmentAllowed,
  getEligiblePetsForCage,
};
