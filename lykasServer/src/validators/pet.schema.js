const { z } = require("zod");

const petCreateSchema = z
  .object({
    name: z.string().min(1).max(100),
    species: z.enum(["Dog", "Cat", "Other"]),
    breed: z.string().max(100).optional(),
    age: z.coerce.number().min(0).max(40).optional(),
    gender: z.enum(["Male", "Female"]).optional(),
    size: z.enum(["Small", "Medium", "Large"]).optional(),
    weight: z.coerce.number().min(0).optional(),
    // Optional: a blank value clears the temperament (stored as null).
    temperament: z
      .preprocess(
        (value) => (value === "" ? null : value),
        z.enum(["Calm", "Playful", "Shy", "Energetic", "Affectionate", "Independent"]).nullable()
      )
      .optional(),
    energyLevel: z.enum(["Low", "Medium", "High"]).optional(),
    healthStatus: z.string().max(500).optional(),
    description: z.string().max(2000).optional(),
    status: z.enum(["Available", "Pending", "Adopted", "Foster"]).optional(),
    shelterId: z.preprocess((value) => value === "" ? null : value, z.string().regex(/^[a-f\d]{24}$/i).nullable()).optional(),
  })
  .strict();

const petUpdateSchema = petCreateSchema.partial();

module.exports = { petCreateSchema, petUpdateSchema };
