const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    displayName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    password: { type: String, select: false },
    // Set whenever the password is (re)hashed — lets authMiddleware.protect
    // reject access tokens issued before a reset/change, closing the gap
    // where a stolen token would otherwise stay valid until its own natural
    // (15 min) expiry even after the password that could mint it changes.
    passwordChangedAt: { type: Date, default: null },

    // Consent record (Privacy Policy + User Agreement), captured at sign-up.
    privacyAccepted: { type: Boolean, default: false },
    privacyAcceptedAt: { type: Date, default: null },
    privacyPolicyVersion: { type: String, default: null },

    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    // Resend throttling (per user): last send time, plus a rolling window
    // counter. Kept on the user so the limit survives restarts and holds
    // across instances without needing Redis.
    emailVerificationLastSentAt: { type: Date, select: false },
    emailVerificationWindowStartedAt: { type: Date, select: false },
    emailVerificationSendCount: { type: Number, select: false },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },

    role: {
      type: String,
      enum: ["user", "staff", "admin", "super_admin"],
      default: "user",
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "suspended", "locked"],
      default: "active",
      index: true,
    },
    lockedUntil: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0 },

    profilePicture: { type: String, default: null },
    notificationsEnabled: { type: Boolean, default: true },
    pushToken: { type: String, default: null }, // NEW — §6.6, completes the push-notification loop

    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Pet" }],
    volunteerHours: { type: Number, default: 0 },

    phone: { type: String, default: null },
    address: { type: String, default: null },
    phoneVerified: { type: Boolean, default: false },
    addressConfirmed: { type: Boolean, default: false },

    identityVerificationStatus: {
      type: String,
      enum: ["unverified", "pending", "verified", "rejected"],
      default: "unverified",
    },
    identityVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    identityVerifiedAt: { type: Date, default: null },
    identityVerificationNotes: { type: String, default: null },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password") || !this.password) return;
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordChangedAt = new Date();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.isLocked = function isLocked() {
  return this.status === "locked" && this.lockedUntil && this.lockedUntil > new Date();
};

module.exports = mongoose.model("User", userSchema);