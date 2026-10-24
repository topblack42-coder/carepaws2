const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");

const User = require("../models/User");
const Session = require("../models/Session");
const LoginHistory = require("../models/LoginHistory");
const TokenBlacklist = require("../models/TokenBlacklist");

const { sendTemplatedEmail } = require("../utils/emailService");
const logger = require("../utils/logger");
const { buildResetUrls, getWebBaseUrl, APP_SCHEME_URL } = require("../utils/authLinks");
const { issueVerificationEmail, resendRetryAfterSeconds, claimResendSlot } = require("../utils/emailVerification");
const {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  refreshExpiryDate,
} = require("../utils/tokens");

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function publicUser(user) {
  return {
    id: user._id,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    profilePicture: user.profilePicture,
    identityVerificationStatus: user.identityVerificationStatus,
    notificationsEnabled: user.notificationsEnabled,
    phone: user.phone,
    address: user.address,
  };
}

async function issueSession(user, req) {
  const accessToken = signAccessToken(user);
  const refreshToken = generateRefreshToken();

  await Session.create({
    user: user._id,
    refreshTokenHash: hashToken(refreshToken),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    expiresAt: refreshExpiryDate(),
  });

  return { accessToken, refreshToken };
}

// POST /api/auth/register
async function register(req, res, next) {
  try {
    const { displayName, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const user = await User.create({ displayName, email, password });

    // The account is kept even if the email can't be sent; the client uses
    // emailSent to point the user at the resend flow.
    const emailResult = await issueVerificationEmail(user);
    if (!emailResult.emailSent) {
      logger.warn({ userId: user._id, reason: emailResult.reason }, "Verification email not sent at registration");
    }

    const { accessToken, refreshToken } = await issueSession(user, req);

    return res.status(201).json({
      success: true,
      message: "Account created",
      data: {
        user: publicUser(user),
        accessToken,
        refreshToken,
        emailSent: emailResult.emailSent,
        emailSkipped: emailResult.emailSkipped,
      },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      await LoginHistory.create({ email, success: false, reason: "no_such_user", ipAddress: req.ip, userAgent: req.headers["user-agent"] });
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    // A soft-deleted account must not be able to log in at all. Without this,
    // login (unlike refresh() below and authMiddleware.protect()) handed out
    // a perfectly valid access+refresh token pair for a deleted user — the
    // token then failed on the very next protected request with 401 "User no
    // longer exists" from protect(), which the client correctly reads as an
    // invalid session and force-logs-out. That produced a confusing "logs in
    // fine, then gets kicked out the moment any real screen loads" loop
    // instead of a clean rejection at sign-in. Uses the same generic message
    // as the !user branch above — a deleted account should be no more
    // distinguishable to an unauthenticated caller than one that never
    // existed at all.
    if (user.isDeleted) {
      await LoginHistory.create({ user: user._id, email, success: false, reason: "no_such_user", ipAddress: req.ip, userAgent: req.headers["user-agent"] });
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    if (user.isLocked()) {
      await LoginHistory.create({ user: user._id, email, success: false, reason: "account_locked", ipAddress: req.ip, userAgent: req.headers["user-agent"] });
      return res.status(423).json({ success: false, message: "Account is temporarily locked. Try again later." });
    }

    if (user.status === "suspended") {
      await LoginHistory.create({ user: user._id, email, success: false, reason: "account_suspended", ipAddress: req.ip, userAgent: req.headers["user-agent"] });
      return res.status(403).json({ success: false, message: "Account is suspended" });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      user.failedLoginAttempts += 1;

      if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        user.status = "locked";
        user.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
      }
      await user.save();

      await LoginHistory.create({
        user: user._id,
        email,
        success: false,
        reason: user.status === "locked" ? "locked_after_failed_attempts" : "wrong_password",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    // Successful login — reset the failure counter and any stale lock.
    user.failedLoginAttempts = 0;
    if (user.status === "locked") user.status = "active";
    user.lockedUntil = null;
    await user.save();

    await LoginHistory.create({ user: user._id, email, success: true, ipAddress: req.ip, userAgent: req.headers["user-agent"] });

    const { accessToken, refreshToken } = await issueSession(user, req);

    return res.json({ success: true, message: "Logged in", data: { user: publicUser(user), accessToken, refreshToken } });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/google
async function googleAuth(req, res, next) {
  try {
    const { idToken } = req.body;

    const ticket = await googleClient.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      return res.status(401).json({ success: false, message: "Invalid Google token" });
    }

    let user = await User.findOne({ email: payload.email });
    if (!user) {
      user = await User.create({
        displayName: payload.name || payload.email,
        email: payload.email,
        emailVerified: true,
        profilePicture: payload.picture,
      });
    } else if (user.isDeleted) {
      // Same gap as login() above, reached via the Google path instead: an
      // existing-but-deleted row means `!user` is false here, so without this
      // check we'd fall through, flip emailVerified on a deleted account, and
      // hand out a session that protect() would immediately reject anyway.
      return res.status(401).json({ success: false, message: "User no longer exists" });
    } else if (!user.emailVerified) {
      user.emailVerified = true;
      await user.save();
    }

    if (user.status !== "active") {
      return res.status(403).json({ success: false, message: `Account is ${user.status}` });
    }

    const { accessToken, refreshToken } = await issueSession(user, req);
    await LoginHistory.create({ user: user._id, email: user.email, success: true, reason: "google_oauth", ipAddress: req.ip, userAgent: req.headers["user-agent"] });

    return res.json({ success: true, message: "Logged in", data: { user: publicUser(user), accessToken, refreshToken } });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/refresh — rotates the refresh token on every use
async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    const tokenHash = hashToken(refreshToken);

    const session = await Session.findOne({ refreshTokenHash: tokenHash, revoked: false }).select("+refreshTokenHash");

    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ success: false, message: "Invalid or expired refresh token" });
    }

    const user = await User.findById(session.user);
    if (!user || user.isDeleted || user.status !== "active") {
      return res.status(401).json({ success: false, message: "Session no longer valid" });
    }

    // Rotate: revoke the used token, issue a new pair.
    session.revoked = true;
    session.revokedAt = new Date();
    await session.save();

    const { accessToken, refreshToken: newRefreshToken } = await issueSession(user, req);

    return res.json({ success: true, data: { accessToken, refreshToken: newRefreshToken } });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/logout
async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body || {};

    if (refreshToken) {
      await Session.updateOne({ refreshTokenHash: hashToken(refreshToken) }, { revoked: true, revokedAt: new Date() });
    }

    if (req.token) {
      let expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      try {
        const decoded = verifyAccessToken(req.token);
        if (decoded?.exp) expiresAt = new Date(decoded.exp * 1000);
      } catch {
        // token already invalid/expired — nothing to blacklist meaningfully
      }
      await TokenBlacklist.create({ token: req.token, userId: req.user?._id, expiresAt, reason: "logout" });
    }

    return res.json({ success: true, message: "Logged out" });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/me
async function me(req, res) {
  return res.json({ success: true, data: { user: publicUser(req.user) } });
}

// POST /api/auth/forgot-password
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    // Always respond success to avoid leaking which emails are registered.
    if (!user) {
      return res.json({ success: true, message: "If that email exists, a reset link has been sent" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = hashToken(resetToken);
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    await sendTemplatedEmail({
      to: user.email,
      templateKey: "password_reset",
      data: { displayName: user.displayName, ...buildResetUrls(resetToken) },
    });

    return res.json({ success: true, message: "If that email exists, a reset link has been sent" });
  } catch (err) {
    next(err);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// GET /api/auth/reset-password-link?token=... — the https link in the reset
// email. Redirect bridge only: it never reads, validates or consumes the token
// (POST /reset-password does that). It hands off to the app via carepaws://
// and offers a browser fallback. The token is URL-encoded, then HTML-escaped,
// and the script reads the link from the DOM rather than embedding the token
// in JS.
async function resetPasswordLink(req, res) {
  const nonce = crypto.randomBytes(16).toString("base64");
  // helmet's default CSP blocks inline script; allow only this page's nonce'd one.
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  });

  const token = typeof req.query.token === "string" ? req.query.token : "";
  const shell = (body, script = "") =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Reset your CarePaws password</title>` +
    `<style nonce="${nonce}">body{font-family:system-ui,sans-serif;text-align:center;padding:12vh 24px;color:#1f2937}` +
    `.btn{display:inline-block;padding:12px 24px;background:#1E6B45;color:#fff;border-radius:8px;text-decoration:none;font-weight:600}` +
    `p{max-width:420px;margin:16px auto}a.link{color:#1E6B45}</style></head><body>${body}${script}</body></html>`;

  if (token.length < 10 || token.length > 512) {
    return res.status(400).type("html").send(shell("<h1>Link invalid</h1><p>Open the CarePaws app and request a new password reset email.</p>"));
  }

  const encoded = encodeURIComponent(token);
  const appUrl = escapeHtml(`${APP_SCHEME_URL}reset-password?token=${encoded}`);
  const webBase = getWebBaseUrl();
  const webLink = webBase
    ? `<p><a class="link" href="${escapeHtml(`${webBase}/reset-password?token=${encoded}`)}">Open in browser</a></p>`
    : "";

  const body =
    `<h1>Reset your password \u{1F43E}</h1>` +
    `<p>Opening the CarePaws app&hellip; If nothing happens, tap the button below.</p>` +
    `<p><a id="open-app" class="btn" href="${appUrl}">Open CarePaws app</a></p>` +
    webLink +
    `<p style="font-size:14px;color:#6b7280">This link works once you have the CarePaws app installed. It expires 1 hour after it was requested.</p>`;
  const script = `<script nonce="${nonce}">window.location = document.getElementById("open-app").href;</script>`;
  return res.type("html").send(shell(body, script));
}

// POST /api/auth/reset-password
async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;
    const tokenHash = hashToken(token);

    const user = await User.findOne({
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: new Date() },
    }).select("+password +resetPasswordToken +resetPasswordExpires");

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.failedLoginAttempts = 0;
    if (user.status === "locked") user.status = "active";
    user.lockedUntil = null;
    await user.save();

    // Password changed — revoke all existing sessions.
    await Session.updateMany({ user: user._id, revoked: false }, { revoked: true, revokedAt: new Date() });

    return res.json({ success: true, message: "Password reset — please log in again" });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/verify-email
async function consumeVerificationToken(token) {
  const tokenHash = hashToken(token);
  const user = await User.findOne({
    emailVerificationToken: tokenHash,
    emailVerificationExpires: { $gt: new Date() },
  }).select("+emailVerificationToken +emailVerificationExpires");

  if (!user) return false;

  user.emailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save();
  return true;
}

async function verifyEmail(req, res, next) {
  try {
    const ok = await consumeVerificationToken(req.body.token);
    if (!ok) {
      return res.status(400).json({ success: false, message: "Invalid or expired verification token" });
    }
    return res.json({ success: true, message: "Email verified" });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/verify-email-link?token=... — one-click link from the email.
// Verifies directly and renders a small HTML page (no app/web client needed).
async function verifyEmailLink(req, res) {
  const page = (title, msg) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
    `<body style="font-family:system-ui,sans-serif;text-align:center;padding:15vh 24px;color:#1f2937"><h1>${title}</h1><p>${msg}</p></body></html>`;
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (token.length < 10 || !(await consumeVerificationToken(token))) {
      return res.status(400).type("html").send(page("Link invalid or expired", "Open the CarePaws app and request a new verification email."));
    }
    return res.type("html").send(page("Email verified \u{1F43E}", "Thanks! You can close this page and return to the CarePaws app."));
  } catch (err) {
    return res.status(500).type("html").send(page("Something went wrong", "Please try again in a moment."));
  }
}

// POST /api/auth/resend-verification (authenticated; acts only on req.user)
async function resendVerification(req, res, next) {
  try {
    const user = await User.findById(req.user._id).select(
      "+emailVerificationLastSentAt +emailVerificationWindowStartedAt +emailVerificationSendCount"
    );
    if (!user) return res.status(401).json({ success: false, message: "User no longer exists" });

    if (user.emailVerified) {
      return res.json({ success: true, message: "Email already verified", data: { emailSkipped: true, alreadyVerified: true } });
    }

    const retryAfterSeconds = resendRetryAfterSeconds(user);
    if (retryAfterSeconds > 0) {
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message: `Please wait ${retryAfterSeconds} seconds before requesting another verification email`,
        retryAfterSeconds,
      });
    }

    if (!(await claimResendSlot(user))) {
      // A parallel request just claimed the slot.
      res.set("Retry-After", "60");
      return res.status(429).json({
        success: false,
        message: "A verification email was just sent. Please wait before requesting another",
        retryAfterSeconds: 60,
      });
    }

    const result = await issueVerificationEmail(user);

    if (!result.emailSent && result.reason !== "not_configured") {
      logger.warn({ userId: user._id, reason: result.reason }, "Resend verification email failed");
      const status = result.reason === "send_failed" ? 502 : 503;
      return res.status(status).json({ success: false, message: "We couldn't send the verification email right now. Please try again shortly" });
    }

    return res.json({
      success: true,
      message: result.emailSent ? "Verification email sent" : "Email delivery isn't configured on this server",
      data: { emailSkipped: result.emailSkipped },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  resendVerification,
  register,
  login,
  googleAuth,
  refresh,
  logout,
  me,
  forgotPassword,
  resetPassword,
  verifyEmail,
  verifyEmailLink,
  resetPasswordLink,
};

// ===== Admin user-management (mounted under /api/auth per §5.3) =====

const { buildListQuery, buildSort, buildPagination } = require("../utils/queryBuilder");
const { writeAuditLog } = require("../utils/auditLogger");

// GET /api/auth/users — admin
async function listUsers(req, res, next) {
  try {
    const filter = buildListQuery(req.query, {
      searchFields: ["displayName", "email"],
      filterFields: ["role", "status", "identityVerificationStatus"],
      allowIncludeDeleted: true,
    });
    const sort = buildSort(req.query);
    const total = await User.countDocuments(filter);
    const { page, limit, skip, ...paginationRest } = buildPagination(total, req.query.page, req.query.limit);
    const data = await User.find(filter).sort(sort).skip(skip).limit(limit);
    return res.json({ success: true, data, pagination: { page, limit, ...paginationRest } });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/users/verification-queue — admin
async function verificationQueue(req, res, next) {
  try {
    const users = await User.find({ identityVerificationStatus: "pending" }).sort({ updatedAt: 1 });
    // Attach each user's most recent government ID file so staff can open it
    // straight from the queue.
    const UserDocument = require("../models/UserDocument");
    const docs = await UserDocument.find({ user: { $in: users.map((u) => u._id) }, type: "government_id" })
      .sort({ createdAt: -1 })
      .select("user fileUrl");
    const idByUser = new Map();
    for (const d of docs) {
      const key = d.user.toString();
      if (!idByUser.has(key)) idByUser.set(key, d.fileUrl);
    }
    const data = users.map((u) => ({ ...u.toObject(), idDocumentUrl: idByUser.get(u._id.toString()) || null }));
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/users/export — admin
async function exportUsers(req, res, next) {
  try {
    const users = await User.find({ isDeleted: { $ne: true } }).select("displayName email role status createdAt");
    const header = "displayName,email,role,status,createdAt\n";
    const rows = users
      .map((u) => `"${u.displayName}","${u.email}","${u.role}","${u.status}","${u.createdAt.toISOString()}"`)
      .join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=users.csv");
    return res.send(header + rows);
  } catch (err) {
    next(err);
  }
}

// PUT /api/auth/users/:id/role — admin
async function updateUserRole(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const previousValues = { role: user.role };
    user.role = req.body.role;
    await user.save();

    await writeAuditLog({ actor: req.user._id, action: "user.role_update", entityType: "User", entityId: user._id, previousValues, newValues: { role: user.role }, req });

    return res.json({ success: true, data: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

// PUT /api/auth/users/:id/status — admin
async function updateUserStatus(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const previousValues = { status: user.status };
    user.status = req.body.status;
    if (req.body.status !== "locked") user.lockedUntil = null;
    await user.save();

    if (req.body.status === "suspended") {
      await Session.updateMany({ user: user._id, revoked: false }, { revoked: true, revokedAt: new Date() });
    }

    await writeAuditLog({ actor: req.user._id, action: "user.status_update", entityType: "User", entityId: user._id, previousValues, newValues: { status: user.status }, req });

    return res.json({ success: true, data: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

// PUT /api/auth/users/:id/verification — admin
async function updateUserVerification(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.identityVerificationStatus = req.body.identityVerificationStatus;
    user.identityVerifiedBy = req.user._id;
    user.identityVerifiedAt = new Date();
    user.identityVerificationNotes = req.body.notes;
    await user.save();

    return res.json({ success: true, data: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/auth/users/:id — soft delete, admin
async function deleteUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.isDeleted = true;
    user.deletedAt = new Date();
    user.deletedBy = req.user._id;
    await user.save();

    await writeAuditLog({ actor: req.user._id, action: "user.delete", entityType: "User", entityId: user._id, req });

    return res.json({ success: true, message: "User archived" });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/users/:id/restore — admin
async function restoreUser(req, res, next) {
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, isDeleted: true },
      { isDeleted: false, deletedAt: null, deletedBy: null },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, message: "Deleted user not found" });
    return res.json({ success: true, data: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/auth/users/:id/permanent — super_admin only
async function permanentlyDeleteUser(req, res, next) {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    await writeAuditLog({ actor: req.user._id, action: "user.permanent_delete", entityType: "User", entityId: user._id, req });
    return res.json({ success: true, message: "User permanently deleted" });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/users/:id/history — admin
async function userHistory(req, res, next) {
  try {
    const AuditLog = require("../models/AuditLog");
    const history = await AuditLog.find({ entityType: "User", entityId: req.params.id }).sort({ createdAt: -1 });
    return res.json({ success: true, data: history });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/users/:id/login-history — admin
async function userLoginHistory(req, res, next) {
  try {
    const history = await LoginHistory.find({ user: req.params.id }).sort({ createdAt: -1 }).limit(100);
    return res.json({ success: true, data: history });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/login-history — self
async function myLoginHistory(req, res, next) {
  try {
    const history = await LoginHistory.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
    return res.json({ success: true, data: history });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/audit-logs — super_admin only
async function listAuditLogs(req, res, next) {
  try {
    const AuditLog = require("../models/AuditLog");
    const logs = await AuditLog.find().populate("actor", "displayName email").sort({ createdAt: -1 }).limit(200);
    return res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/admin/force-reset/:id — admin forces a password-reset email
async function forceReset(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const crypto = require("crypto");
    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = hashToken(resetToken);
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    await sendTemplatedEmail({
      to: user.email,
      templateKey: "password_reset",
      data: { displayName: user.displayName, ...buildResetUrls(resetToken) },
    });

    await writeAuditLog({ actor: req.user._id, action: "user.force_reset", entityType: "User", entityId: user._id, req });

    return res.json({ success: true, message: "Password reset email sent" });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/favorites
async function getFavorites(req, res, next) {
  try {
    const user = await User.findById(req.user._id).populate("favorites");
    return res.json({ success: true, data: user.favorites });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/favorites/:petId
async function toggleFavorite(req, res, next) {
  try {
    const user = await User.findById(req.user._id);
    const idx = user.favorites.findIndex((id) => id.toString() === req.params.petId);
    if (idx >= 0) {
      user.favorites.splice(idx, 1);
    } else {
      user.favorites.push(req.params.petId);
    }
    await user.save();
    return res.json({ success: true, data: user.favorites });
  } catch (err) {
    next(err);
  }
}

// PUT /api/auth/profile
async function updateProfile(req, res, next) {
  try {
    const allowed = ["displayName", "phone", "address", "notificationsEnabled", "pushToken"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) req.user[key] = req.body[key];
    }
    await req.user.save();
    return res.json({ success: true, data: publicUser(req.user) });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/sessions
async function listSessions(req, res, next) {
  try {
    const sessions = await Session.find({ user: req.user._id, revoked: false }).select("-refreshTokenHash").sort({ lastActiveAt: -1 });
    return res.json({ success: true, data: sessions });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/auth/sessions/:id
async function revokeSession(req, res, next) {
  try {
    const session = await Session.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { revoked: true, revokedAt: new Date() },
      { new: true }
    );
    if (!session) return res.status(404).json({ success: false, message: "Session not found" });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/auth/sessions — revoke all of the current user's sessions
async function revokeAllSessions(req, res, next) {
  try {
    await Session.updateMany({ user: req.user._id, revoked: false }, { revoked: true, revokedAt: new Date() });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports.listUsers = listUsers;
module.exports.verificationQueue = verificationQueue;
module.exports.exportUsers = exportUsers;
module.exports.updateUserRole = updateUserRole;
module.exports.updateUserStatus = updateUserStatus;
module.exports.updateUserVerification = updateUserVerification;
module.exports.deleteUser = deleteUser;
module.exports.restoreUser = restoreUser;
module.exports.permanentlyDeleteUser = permanentlyDeleteUser;
module.exports.userHistory = userHistory;
module.exports.userLoginHistory = userLoginHistory;
module.exports.myLoginHistory = myLoginHistory;
module.exports.listAuditLogs = listAuditLogs;
module.exports.forceReset = forceReset;
module.exports.getFavorites = getFavorites;
module.exports.toggleFavorite = toggleFavorite;
module.exports.updateProfile = updateProfile;
module.exports.listSessions = listSessions;
module.exports.revokeSession = revokeSession;
module.exports.revokeAllSessions = revokeAllSessions;
