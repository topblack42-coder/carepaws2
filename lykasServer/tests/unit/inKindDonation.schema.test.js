const { inKindDonationCreateSchema } = require("../../src/validators/inKindDonation.schema");

describe("inKindDonationCreateSchema", () => {
  const base = { name: "Dog food", dropOff: "walk_in", acceptedTerms: "true" };

  it("accepts a walk-in donation with consent (multipart string values)", () => {
    const result = inKindDonationCreateSchema.safeParse({ ...base, quantity: "5" });
    expect(result.success).toBe(true);
    expect(result.data.quantity).toBe(5);
    expect(result.data.acceptedTerms).toBe(true);
  });

  it("rejects a donation without consent", () => {
    expect(inKindDonationCreateSchema.safeParse({ name: "Dog food", dropOff: "walk_in" }).success).toBe(false);
    expect(inKindDonationCreateSchema.safeParse({ ...base, acceptedTerms: "false" }).success).toBe(false);
  });

  it.each(["schedule", "courier"])("requires a pickup address for %s", (dropOff) => {
    expect(inKindDonationCreateSchema.safeParse({ ...base, dropOff }).success).toBe(false);
    expect(inKindDonationCreateSchema.safeParse({ ...base, dropOff, pickupAddress: "12 Rizal St, Tarlac City" }).success).toBe(true);
  });
});
