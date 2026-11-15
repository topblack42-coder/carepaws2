const { z } = require("zod");

const emergencyContactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(5).max(40),
    relationship: z.string().trim().max(80).optional(),
  })
  .strict();

const fosterCreateSchema = z
  .object({
    pet: z.string().min(1),
    fosterer: z.string().min(1),
    application: z.string().min(1),
    startDate: z.string(),
    expectedEndDate: z.string().optional(),
    trialDurationDays: z.number().int().min(30).max(60).optional(),
    weeklyReportsRequired: z.number().int().positive().optional(),
    fosterAgreementSigned: z.boolean().optional(),
    pickupNotes: z.string().optional(),
    notes: z.string().optional(),
    emergencyContact: emergencyContactSchema.optional(),
  })
  .strict();

// Completing a placement. Extensions use fosterExtendSchema instead.
const fosterEndSchema = z
  .object({
    outcome: z.enum(["ADOPTED", "RETURNED"]),
    // Staff check of the animal at the end. Required: reports alone do not prove health.
    finalHealthCheck: z
      .object({
        notes: z.string().trim().min(10).max(2000),
        vetVerified: z.boolean(),
      })
      .strict(),
    // Only an admin may close a placement with reports missing or unreviewed, and must say why.
    completionException: z.object({ reason: z.string().trim().min(10).max(1000) }).strict().optional(),
    returnNotes: z.string().optional(),
    staffNotes: z.string().optional(),
  })
  .strict();

const fosterExtendSchema = z
  .object({
    extensionDays: z.number().int().min(7).max(30),
    reason: z.string().trim().min(10).max(2000),
    // Defaults to the staff member making the request.
    recommendedBy: z.string().min(1).optional(),
    vetAgreed: z.boolean(),
    vetNotes: z.string().trim().max(1000).optional(),
    fostererAgreed: z.boolean(),
  })
  .strict();

const returnRequestSchema = z
  .object({
    urgency: z.enum(["routine", "emergency"]),
    reason: z.string().trim().min(5).max(2000),
  })
  .strict();

const weeklyReportSchema = z
  .object({
    weekNumber: z.number().int().positive(),
    weightChange: z.number().optional(),
    appetite: z.enum(["Excellent", "Good", "Fair", "Poor"]).optional(),
    energy: z.enum(["Very Active", "Active", "Low", "Lethargic"]).optional(),
    behavior: z.string().optional(),
    healthConcerns: z.string().optional(),
    vetVisitRequired: z.boolean().optional(),
    overallProgress: z.enum(["Excellent", "Good", "Fair", "Needs Attention"]).optional(),
    notes: z.string().optional(),
  })
  .strict();

module.exports = {
  fosterCreateSchema,
  fosterEndSchema,
  fosterExtendSchema,
  returnRequestSchema,
  emergencyContactSchema,
  weeklyReportSchema,
};
