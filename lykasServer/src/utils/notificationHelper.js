const Notification = require("../models/Notification");
const User = require("../models/User");
const logger = require("./logger");

/**
 * Creates a Notification record and, if the recipient has
 * notificationsEnabled and a registered Expo push token, also sends a
 * push notification via the Expo push API — completing the loop that
 * was never wired up in the source (§6.6): expo-notifications was
 * declared as a dependency but never called anywhere.
 */
async function notify({ recipient, sender = null, type, title, message, refModel = null, refId = null, dedupeKey = undefined }) {
  const notification = await Notification.create({ recipient, sender, type, title, message, refModel, refId, dedupeKey });

  try {
    const user = await User.findById(recipient).select("notificationsEnabled pushToken");
    if (user?.notificationsEnabled && isValidExpoPushToken(user.pushToken)) {
      await sendExpoPush(user.pushToken, title, message, { type, refModel, refId: refId?.toString() });
    }
  } catch (err) {
    logger.error({ err, recipient }, "Failed to send push notification");
  }

  return notification;
}

function isValidExpoPushToken(token) {
  return typeof token === "string" && /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token.trim());
}

async function sendExpoPush(pushToken, title, body, data = {}) {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ to: pushToken, title, body, data, sound: "default" }),
  });

  if (!res.ok) {
    logger.error({ status: res.status }, "Expo push send failed");
  }
}

/**
 * Creates one persistent notification for an automated lifecycle event.
 * The unique dedupe key makes repeated webhooks/jobs/mutations idempotent.
 */
async function notifyOnce({ recipient, sender = null, type, title, message, refModel = null, refId = null, dedupeKey }) {
  const key = dedupeKey || `${recipient}:${type}:${refModel || "none"}:${refId || "none"}`;
  const existing = await Notification.findOne({ dedupeKey: key });
  if (existing) return existing;
  try {
    return await notify({ recipient, sender, type, title, message, refModel, refId, dedupeKey: key });
  } catch (err) {
    if (err?.code === 11000) return Notification.findOne({ dedupeKey: key });
    throw err;
  }
}

module.exports = { notify, notifyOnce };