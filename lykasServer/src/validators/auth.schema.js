const { z } = require("zod");

const registerSchema = z
  .object({
    displayName: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(8).max(128),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: "You must agree to the Privacy Policy and User Agreement" }),
    }),
  })
  .strict();

const loginSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
  })
  .strict();

const googleAuthSchema = z
  .object({
    idToken: z.string().min(10),
    platform: z.enum(["mobile", "web"]).optional(),
    // Required only when the Google account has no CarePaws account yet.
    acceptedTerms: z.boolean().optional(),
  })
  .strict();

const forgotPasswordSchema = z
  .object({
    email: z.string().email(),
  })
  .strict();

const resetPasswordSchema = z
  .object({
    token: z.string().min(10),
    password: z.string().min(8).max(128),
  })
  .strict();

const verifyEmailSchema = z
  .object({
    token: z.string().min(10),
  })
  .strict();

const refreshSchema = z
  .object({
    refreshToken: z.string().min(10),
  })
  .strict();


const updateRoleSchema = z.object({ role: z.enum(["user", "staff", "admin", "super_admin"]) }).strict();
const updateStatusSchema = z.object({ status: z.enum(["active", "suspended", "locked"]) }).strict();
const updateVerificationSchema = z
  .object({
    identityVerificationStatus: z.enum(["unverified", "pending", "verified", "rejected"]),
    notes: z.string().max(1000).optional(),
  })
  .strict();
const updateProfileSchema = z
  .object({
    displayName: z.string().min(2).max(100).optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    notificationsEnabled: z.boolean().optional(),
    // Nullable — the mobile app explicitly PUTs { pushToken: null } to clear
    // the token server-side when the user disables push notifications.
    pushToken: z.string().nullable().optional(),
  })
  .strict();

module.exports = {
  updateRoleSchema,
  updateStatusSchema,
  updateVerificationSchema,
  updateProfileSchema,
  registerSchema,
  loginSchema,
  googleAuthSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  refreshSchema,
};
