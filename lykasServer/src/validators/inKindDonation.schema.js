const { z } = require("zod");

const inKindDonationCreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    // Sent as multipart/form-data (photos), so numbers/booleans arrive as strings.
    quantity: z.coerce.number().min(0).optional(),
    unit: z.string().max(50).optional(),
    items: z
      .array(z.object({ name: z.string(), quantity: z.number().optional(), unit: z.string().optional() }).strict())
      .optional(),
    dropOff: z.enum(["walk_in", "schedule", "courier"]),
    notes: z.string().max(1000).optional(),
    pickupAddress: z.string().trim().max(300).optional(),
    acceptedTerms: z.preprocess(
      (value) => (value === "true" ? true : value),
      z.literal(true, { errorMap: () => ({ message: "You must agree to the Privacy Policy and User Agreement" }) })
    ),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.dropOff !== "walk_in" && !data.pickupAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pickupAddress"],
        message: "A pickup address is required for scheduled pickup or courier",
      });
    }
  });

const inKindDonationStatusSchema = z
  .object({
    status: z.enum(["pending", "confirmed", "received", "cancelled"]),
    staffNote: z.string().max(1000).optional(),
  })
  .strict();

module.exports = { inKindDonationCreateSchema, inKindDonationStatusSchema };
