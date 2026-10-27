const { z } = require("zod");

const dateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date and time");
const METHODS = ["Shelter pickup", "Home delivery"];

const pickupFields = {
  scheduledDate: dateString,
  method: z.enum(METHODS),
  location: z.string().trim().max(300).optional(),
  notes: z.string().max(1000).optional(),
};

const needsLocation = (data, ctx) => {
  if (data.method === "Home delivery" && !data.location) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["location"], message: "A delivery address is required for home delivery" });
  }
};

const adoptionPickupCreateSchema = z
  .object({ application: z.string().min(1), ...pickupFields })
  .strict()
  .superRefine(needsLocation);

// Reschedule / edit: every field optional; location is re-checked when method is Home delivery.
const adoptionPickupUpdateSchema = z.object(pickupFields).partial().strict().superRefine(needsLocation);

const adoptionPickupCompleteSchema = z.object({ notes: z.string().max(1000).optional() }).strict();

const adoptionPickupCancelSchema = z.object({ cancelReason: z.string().max(500).optional() }).strict();

module.exports = { adoptionPickupCreateSchema, adoptionPickupUpdateSchema, adoptionPickupCompleteSchema, adoptionPickupCancelSchema };
