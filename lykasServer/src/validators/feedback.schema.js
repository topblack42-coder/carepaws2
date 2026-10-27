const { z } = require("zod");

const feedbackCreateSchema = z
  .object({
    type: z.enum(["general", "complaint", "review", "suggestion"]),
    rating: z.number().int().min(1).max(5).optional(),
    subject: z.string().max(200).optional(),
    message: z.string().min(1).max(2000),
    relatedPet: z.string().optional(),
    application: z.string().optional(),
  })
  .strict();

const feedbackUpdateSchema = z
  .object({
    status: z.enum(["new", "in_review", "responded", "resolved", "archived"]).optional(),
    isPublic: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    adminResponse: z.string().max(2000).optional(),
  })
  .strict();

module.exports = { feedbackCreateSchema, feedbackUpdateSchema };
