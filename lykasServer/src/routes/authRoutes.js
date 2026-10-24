const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const { protect, adminOnly, requireRole } = require("../middleware/authMiddleware");
const validateRequest = require("../middleware/validateRequest");
const { loginLimiter, registerLimiter, passwordResetLimiter, resendVerificationLimiter, resetLinkLimiter } = require("../middleware/rateLimitMiddleware");
const { uploadImage } = require("../middleware/uploadMiddleware");
const {
  registerSchema,
  loginSchema,
  googleAuthSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  refreshSchema,
  updateRoleSchema,
  updateStatusSchema,
  updateVerificationSchema,
  updateProfileSchema,
} = require("../validators/auth.schema");

// --- Public / self-service ---
router.post("/register", registerLimiter, validateRequest(registerSchema), authController.register);
router.post("/login", loginLimiter, validateRequest(loginSchema), authController.login);
router.post("/google", validateRequest(googleAuthSchema), authController.googleAuth);
router.post("/refresh", validateRequest(refreshSchema), authController.refresh);
router.post("/logout", protect, authController.logout);
router.get("/me", protect, authController.me);
router.put("/profile", protect, validateRequest(updateProfileSchema), authController.updateProfile);
router.post("/forgot-password", passwordResetLimiter, validateRequest(forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", validateRequest(resetPasswordSchema), authController.resetPassword);
router.get("/reset-password-link", resetLinkLimiter, authController.resetPasswordLink);
router.post("/verify-email", validateRequest(verifyEmailSchema), authController.verifyEmail);
router.get("/verify-email-link", authController.verifyEmailLink);
router.post("/resend-verification", protect, resendVerificationLimiter, authController.resendVerification);

router.get("/favorites", protect, authController.getFavorites);
router.post("/favorites/:petId", protect, authController.toggleFavorite);

router.get("/sessions", protect, authController.listSessions);
router.delete("/sessions/:id", protect, authController.revokeSession);
router.delete("/sessions", protect, authController.revokeAllSessions);
router.get("/login-history", protect, authController.myLoginHistory);

// --- Admin ---
router.get("/users", protect, adminOnly, authController.listUsers);
router.get("/users/verification-queue", protect, adminOnly, authController.verificationQueue);
router.get("/users/export", protect, adminOnly, authController.exportUsers);
router.put("/users/:id/role", protect, requireRole("super_admin"), validateRequest(updateRoleSchema), authController.updateUserRole);
router.put("/users/:id/status", protect, adminOnly, validateRequest(updateStatusSchema), authController.updateUserStatus);
router.put("/users/:id/verification", protect, adminOnly, validateRequest(updateVerificationSchema), authController.updateUserVerification);
router.post("/users/:id/impersonate", protect, requireRole("super_admin"), (req, res) =>
  res.status(501).json({ success: false, message: "Impersonation is intentionally not implemented — high-risk feature deferred pending an explicit audit-trail design" })
);
router.delete("/users/:id", protect, adminOnly, authController.deleteUser);
router.post("/users/:id/restore", protect, adminOnly, authController.restoreUser);
router.delete("/users/:id/permanent", protect, requireRole("super_admin"), authController.permanentlyDeleteUser);
router.get("/users/:id/history", protect, adminOnly, authController.userHistory);
router.get("/users/:id/login-history", protect, adminOnly, authController.userLoginHistory);
router.get("/audit-logs", protect, requireRole("super_admin"), authController.listAuditLogs);
router.post("/admin/force-reset/:id", protect, adminOnly, authController.forceReset);
router.post("/profile-picture", protect, uploadImage.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No image uploaded" });
    const cloudinary = require("../config/cloudinary");
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder: "carepaws/profiles" }, (err, r) => (err ? reject(err) : resolve(r)));
      stream.end(req.file.buffer);
    });
    req.user.profilePicture = result.secure_url;
    await req.user.save();
    return res.json({ success: true, data: { profilePicture: req.user.profilePicture } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
