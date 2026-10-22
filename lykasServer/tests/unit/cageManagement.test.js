const mongoose = require("mongoose");
const Shelter = require("../../src/models/Shelter");
const Pet = require("../../src/models/Pet");
const Cage = require("../../src/models/Cage");
const { CageAssignment, QuarantinePeriod } = require("../../src/models/ShelterCare");
const { assertCageAssignmentAllowed, getCagesWithOccupancy, getEligiblePetsForCage } = require("../../src/utils/cageManagement");

describe("cage management", () => {
  async function shelter() {
    return Shelter.create({ name: "Shelter", address: "Address", type: "main_shelter", capacity: 10, status: "active" });
  }
  async function pet(shelterId, species = "Dog") {
    return Pet.create({ name: `Pet-${Math.random()}`, species, shelterId });
  }
  async function cage(shelterId, values = {}) {
    return Cage.create({ shelterId, cageNumber: `C-${Math.random()}`, capacity: 1, createdBy: new mongoose.Types.ObjectId(), ...values });
  }

  it("rejects duplicate active cage assignments", async () => {
    const s = await shelter(); const p = await pet(s._id); const c = await cage(s._id);
    await assertCageAssignmentAllowed(c._id, p._id);
    await CageAssignment.create({ pet: p._id, cageId: c._id, cageNumber: c.cageNumber, assignedBy: new mongoose.Types.ObjectId() });
    await expect(assertCageAssignmentAllowed(c._id, p._id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects cross-shelter assignments and inactive cages", async () => {
    const a = await shelter(); const b = await shelter(); const p = await pet(a._id);
    const c = await cage(b._id);
    await expect(assertCageAssignmentAllowed(c._id, p._id)).rejects.toMatchObject({ message: "Pet and cage must belong to the same shelter" });
    const local = await cage(a._id, { status: "inactive" });
    await expect(assertCageAssignmentAllowed(local._id, p._id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("enforces quarantine-only cages and normal cages", async () => {
    const s = await shelter(); const p = await pet(s._id);
    const quarantineCage = await cage(s._id, { quarantineOnly: true });
    await expect(assertCageAssignmentAllowed(quarantineCage._id, p._id)).rejects.toMatchObject({ message: "Normal pets cannot be assigned to quarantine-only cages" });
    await QuarantinePeriod.create({ pet: p._id, startDate: new Date(), reason: "Test", startedBy: new mongoose.Types.ObjectId() });
    const normalCage = await cage(s._id);
    await expect(assertCageAssignmentAllowed(normalCage._id, p._id)).rejects.toMatchObject({ message: "Quarantined pets can only be assigned to quarantine cages" });
    await expect(assertCageAssignmentAllowed(quarantineCage._id, p._id)).resolves.toBeTruthy();
  });

  it("rejects incompatible species and full cages", async () => {
    const s = await shelter(); const dog = await pet(s._id, "Dog"); const cat = await pet(s._id, "Cat");
    const c = await cage(s._id, { capacity: 2, allowedSpecies: ["Dog", "Cat"] });
    await CageAssignment.create({ pet: dog._id, cageId: c._id, cageNumber: c.cageNumber, assignedBy: new mongoose.Types.ObjectId() });
    await expect(assertCageAssignmentAllowed(c._id, cat._id)).rejects.toMatchObject({ message: "Cage cannot contain incompatible pet species" });
    const full = await cage(s._id, { capacity: 1 });
    await CageAssignment.create({ pet: dog._id, cageId: full._id, cageNumber: full.cageNumber, assignedBy: new mongoose.Types.ObjectId() });
    await expect(assertCageAssignmentAllowed(full._id, cat._id)).rejects.toMatchObject({ message: "Cage is at capacity" });
  });

  it("reports empty and available cage state from active assignments", async () => {
    const s = await shelter(); const p = await pet(s._id); const c = await cage(s._id, { capacity: 2 });
    let rows = await getCagesWithOccupancy({ _id: c._id });
    expect(rows[0]).toMatchObject({ currentOccupancy: 0, availableCapacity: 2, isEmpty: true, availability: "available" });
    await CageAssignment.create({ pet: p._id, cageId: c._id, cageNumber: c.cageNumber, assignedBy: new mongoose.Types.ObjectId() });
    rows = await getCagesWithOccupancy({ _id: c._id });
    expect(rows[0]).toMatchObject({ currentOccupancy: 1, availableCapacity: 1, isEmpty: false });
  });

  it("lists only pets that can actually be assigned to the cage", async () => {
    const s = await shelter(); const other = await shelter();
    const c = await cage(s._id, { capacity: 3, allowedSpecies: ["Dog", "Cat"] });
    const eligibleDog = await pet(s._id, "Dog");
    const caged = await pet(s._id, "Dog");
    const wrongSpecies = await pet(s._id, "Other");
    const quarantined = await pet(s._id, "Dog");
    const otherShelter = await pet(other._id, "Dog");
    const deleted = await Pet.create({ name: "Gone", species: "Dog", shelterId: s._id, isDeleted: true });
    const elsewhere = await cage(s._id);
    await CageAssignment.create({ pet: caged._id, cageId: elsewhere._id, cageNumber: elsewhere.cageNumber, assignedBy: new mongoose.Types.ObjectId() });
    await QuarantinePeriod.create({ pet: quarantined._id, startDate: new Date(), reason: "Test", startedBy: new mongoose.Types.ObjectId() });

    const ids = (await getEligiblePetsForCage(c._id)).map((p) => String(p._id));
    expect(ids).toEqual([String(eligibleDog._id)]);
    [caged, wrongSpecies, quarantined, otherShelter, deleted].forEach((p) => expect(ids).not.toContain(String(p._id)));
  });

  it("limits eligible pets to the species already in the cage and returns quarantined pets for quarantine cages", async () => {
    const s = await shelter();
    const c = await cage(s._id, { capacity: 3, allowedSpecies: ["Dog", "Cat"] });
    const occupant = await pet(s._id, "Dog"); const dog = await pet(s._id, "Dog"); const cat = await pet(s._id, "Cat");
    await CageAssignment.create({ pet: occupant._id, cageId: c._id, cageNumber: c.cageNumber, assignedBy: new mongoose.Types.ObjectId() });

    const ids = (await getEligiblePetsForCage(c._id)).map((p) => String(p._id));
    expect(ids).toEqual([String(dog._id)]);
    expect(ids).not.toContain(String(cat._id));

    const qCage = await cage(s._id, { quarantineOnly: true });
    await QuarantinePeriod.create({ pet: cat._id, startDate: new Date(), reason: "Test", startedBy: new mongoose.Types.ObjectId() });
    expect((await getEligiblePetsForCage(qCage._id)).map((p) => String(p._id))).toEqual([String(cat._id)]);
  });

  it("returns no eligible pets for a full or inactive cage and 404s for an unknown cage", async () => {
    const s = await shelter(); const p = await pet(s._id);
    const inactive = await cage(s._id, { status: "inactive" });
    expect(await getEligiblePetsForCage(inactive._id)).toEqual([]);
    const full = await cage(s._id, { capacity: 1 }); const occupant = await pet(s._id);
    await CageAssignment.create({ pet: occupant._id, cageId: full._id, cageNumber: full.cageNumber, assignedBy: new mongoose.Types.ObjectId() });
    expect(await getEligiblePetsForCage(full._id)).toEqual([]);
    expect(p).toBeTruthy();
    await expect(getEligiblePetsForCage(new mongoose.Types.ObjectId())).rejects.toMatchObject({ statusCode: 404 });
  });
});
