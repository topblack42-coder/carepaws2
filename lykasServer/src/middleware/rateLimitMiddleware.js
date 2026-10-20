const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const { getRedisClientAsync } = require("../config/redis");

/**
 * All four limiters below share a Redis-backed store instead of the
 * default in-memory MemoryStore, which is the fix for the gap called out
 * throughout the spec: limits used to reset on every restart and did not
 * share state across horizontally-scaled instances because `redis` was
 * an unused dependency in the original source.
 */
function redisStore(prefix) {
  return new RedisStore({
    sendCommand: async (...args) => {
      const client = await getRedisClientAsync();
      return client.sendCommand(args);
    },
    prefix: `rl:${prefix}:`,
  });
}

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("global"),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("login"),
  skip: (req) => !req.body?.email || !req.body?.password,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("register"),
  skip: (req) => !req.body?.email || !req.body?.password || !req.body?.displayName,
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("password-reset"),
  skip: (req) => !req.body?.email,
});

// Per-IP cap on resend-verification (the per-user cooldown and cap live in
// utils/emailVerification.js). 3 requests per 15 minutes.
const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("resend-verification"),
  handler: (req, res) => {
    const resetTime = req.rateLimit?.resetTime;
    const retryAfterSeconds = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : 900;
    res.set("Retry-After", String(retryAfterSeconds));
    res.status(429).json({
      success: false,
      message: `Too many verification requests. Please wait ${retryAfterSeconds} seconds and try again`,
      retryAfterSeconds,
    });
  },
});

// Separate bucket from general API traffic (§11.6.8) — a burst of fake
// webhook calls shouldn't be able to exhaust the limiter real users
// depend on for login/browsing.
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("webhook"),
});

module.exports = { globalLimiter, loginLimiter, registerLimiter, passwordResetLimiter, resendVerificationLimiter, webhookLimiter };