const {
  adoptionPickupCreateSchema,
  adoptionPickupUpdateSchema,
} = require("../../src/validators/adoptionPickup.schema");

describe("adoption pickup validators", () => {
  const base = { application: "abc123", scheduledDate: "2026-11-05T10:00", method: "Shelter pickup" };

  it("accepts a shelter pickup without a location", () => {
    expect(adoptionPickupCreateSchema.safeParse(base).success).toBe(true);
  });

  it("requires an address for home delivery", () => {
    const missing = adoptionPickupCreateSchema.safeParse({ ...base, method: "Home delivery" });
    expect(missing.success).toBe(false);
    expect(missing.error.issues[0].path).toEqual(["location"]);
    expect(adoptionPickupCreateSchema.safeParse({ ...base, method: "Home delivery", location: "12 Rizal St, Tarlac City" }).success).toBe(true);
  });

  it("rejects invalid dates and unknown fields", () => {
    expect(adoptionPickupCreateSchema.safeParse({ ...base, scheduledDate: "not a date" }).success).toBe(false);
    expect(adoptionPickupCreateSchema.safeParse({ ...base, status: "completed" }).success).toBe(false);
  });

  it("allows partial updates", () => {
    expect(adoptionPickupUpdateSchema.safeParse({ scheduledDate: "2026-11-06T09:30" }).success).toBe(true);
    expect(adoptionPickupUpdateSchema.safeParse({ method: "Home delivery" }).success).toBe(false);
  });
});
