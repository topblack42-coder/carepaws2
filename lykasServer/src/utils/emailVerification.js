const crypto = require("crypto");

const User = require("../models/User");
const logger = require("./logger");
const { sendTemplatedEmail } = require("./emailService");
const { hashToken } = require("./tokens");

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const RESEND_WINDOW_MS = 15 * 60 * 1000;
const RESEND_MAX_PER_WINDOW = 3;

/**
 * Single place that creates a verification token and emails it, used by
 * both register() and resend-verification so the two can't drift apart.
 *
 * Only the token's hash is stored, and the raw token only ever goes into the
 * email body — it is never logged. Issuing a new token overwrites the old
 * hash, which is what invalidates the previous link.
 *
 * Returns { emailSent, emailSkipped, reason }.
 */
async function issueVerificationEmail(user) {
  const token = crypto.randomBytes(32).toString("hex");
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        emailVerificationToken: hashToken(token),
        emailVerificationExpires: new Date(Date.now() + VERIFICATION_TTL_MS),
      },
    }
  );

  const appVerifyUrl = `${process.env.MOBILE_APP_URL}verify-email?token=${token}`;
  const apiBaseUrl = process.env.API_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  const data = {
    displayName: user.displayName,
    appVerifyUrl,
    // When API_PUBLIC_URL is set, {{verifyUrl}} is a clickable https link the
    // server verifies directly; otherwise it stays the carepaws:// deep link.
    // RENDER_EXTERNAL_URL is set automatically by Render.
    verifyUrl: apiBaseUrl
      ? `${apiBaseUrl.replace(/\/+$/, "")}/api/auth/verify-email-link?token=${token}`
      : appVerifyUrl,
  };
  // Optional web fallback for people who can't open the carepaws:// deep link.
  // Only usable if the verify_email template references {{webVerifyUrl}}.
  if (process.env.WEB_APP_URL) {
    data.webVerifyUrl = `${process.env.WEB_APP_URL.replace(/\/+$/, "")}/verify-email?token=${token}`;
  }

  let result;
  try {
    result = await sendTemplatedEmail({ to: user.email, templateKey: "verify_email", data });
  } catch (err) {
    // Template lookup/DB errors surface here; sendRawEmail itself never throws.
    logger.error({ err, userId: user._id }, "Verification email failed");
    result = { emailSkipped: true, reason: "send_failed" };
  }

  return { emailSent: !result.emailSkipped, emailSkipped: !!result.emailSkipped, reason: result.reason };
}

/**
 * Seconds the user must still wait before another resend, or 0 if allowed.
 * Enforces a minimum gap between sends plus a max count per rolling window.
 */
function resendRetryAfterSeconds(user, now = Date.now()) {
  const last = user.emailVerificationLastSentAt?.getTime();
  if (last && now - last < RESEND_COOLDOWN_MS) {
    return Math.ceil((RESEND_COOLDOWN_MS - (now - last)) / 1000);
  }
  const windowStart = user.emailVerificationWindowStartedAt?.getTime();
  const inWindow = windowStart && now - windowStart < RESEND_WINDOW_MS;
  if (inWindow && (user.emailVerificationSendCount || 0) >= RESEND_MAX_PER_WINDOW) {
    return Math.ceil((RESEND_WINDOW_MS - (now - windowStart)) / 1000);
  }
  return 0;
}

/**
 * Atomically records a send. Compare-and-swap on emailVerificationLastSentAt,
 * so two parallel requests can't both pass the cooldown. Returns false if
 * another request claimed the slot first.
 */
async function claimResendSlot(user, now = Date.now()) {
  const windowStart = user.emailVerificationWindowStartedAt?.getTime();
  const inWindow = windowStart && now - windowStart < RESEND_WINDOW_MS;
  const res = await User.updateOne(
    { _id: user._id, emailVerificationLastSentAt: user.emailVerificationLastSentAt ?? null },
    {
      $set: {
        emailVerificationLastSentAt: new Date(now),
        emailVerificationWindowStartedAt: inWindow ? user.emailVerificationWindowStartedAt : new Date(now),
        emailVerificationSendCount: inWindow ? (user.emailVerificationSendCount || 0) + 1 : 1,
      },
    }
  );
  return res.modifiedCount === 1;
}

module.exports = {
  issueVerificationEmail,
  resendRetryAfterSeconds,
  claimResendSlot,
  RESEND_COOLDOWN_MS,
  RESEND_WINDOW_MS,
  RESEND_MAX_PER_WINDOW,
};
