const { verifyAccessToken } = require("../utils/tokens");
const TokenBlacklist = require("../models/TokenBlacklist");
const User = require("../models/User");

async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const blacklisted = await TokenBlacklist.findOne({ token });
    if (blacklisted) {
      return res.status(401).json({ success: false, message: "Token has been revoked" });
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }

    const user = await User.findById(payload.id);
    if (!user || user.isDeleted) {
      return res.status(401).json({ success: false, message: "User no longer exists" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ success: false, message: `Account is ${user.status}` });
    }

    // A password reset revokes refresh-token sessions, but a still-live
    // access token (up to 15 min) isn't stored anywhere to blacklist by
    // value. Compare its issue time to the last password change instead —
    // this closes that window without needing a DB write on every request.
    // `<` (not `<=`) is deliberate: passwordChangedAt and the token's `iat`
    // are set moments apart within the same request when a password is
    // first created, and both get second-truncated, so the freshly-issued
    // token must never be rejected as its own predecessor.
    if (user.passwordChangedAt) {
      const changedAtSeconds = Math.floor(user.passwordChangedAt.getTime() / 1000);
      if (typeof payload.iat === "number" && payload.iat < changedAtSeconds) {
        return res.status(401).json({ success: false, message: "Password changed — please log in again" });
      }
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authenticated" });
    if (req.user.role === "super_admin" || roles.includes(req.user.role)) return next();
    return res.status(403).json({ success: false, message: "Insufficient role" });
  };
}

const adminOnly = requireRole("staff", "admin", "super_admin");

// Runs after protect(). Gates actions with real-world consequences behind a
// verified email. Staff/admin accounts are exempt: they are provisioned by
// the shelter, and they create records on behalf of applicants through the
// admin app, so the check is about the member acting for themselves.
function requireVerifiedEmail(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "Not authenticated" });
  if (req.user.role !== "user" || req.user.emailVerified) return next();
  return res.status(403).json({ success: false, code: "EMAIL_NOT_VERIFIED", message: "Please verify your email to continue" });
}

module.exports = { protect, requireRole, adminOnly, requireVerifiedEmail };
