const DailyVisit = require("../models/DailyVisit");
const logger = require("./logger");

const TIME_ZONE = "Asia/Manila";
const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD in Manila time, `daysAgo` days back from now. */
function dayKey(daysAgo = 0) {
  return formatter.format(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
}

// userId -> last day we wrote, so a busy user costs one DB write per day,
// not one per request. Resets on restart, which is harmless (upsert is idempotent).
const lastRecorded = new Map();

/**
 * Counts a signed-in member as a visitor for today. Fire-and-forget: tracking
 * must never slow down or fail a request. Staff/admin accounts are not visitors.
 */
function recordVisit(user) {
  if (!user || user.role !== "user") return;
  const id = String(user._id);
  const day = dayKey();
  if (lastRecorded.get(id) === day) return;
  lastRecorded.set(id, day);

  DailyVisit.updateOne({ user: user._id, day }, { $setOnInsert: { user: user._id, day } }, { upsert: true }).catch((err) => {
    lastRecorded.delete(id); // retry on the next request
    logger.error({ err }, "Failed to record visit");
  });
}

/** YYYY-MM-DD (Manila time) of any date, for comparing calendar days. */
function dayOf(date) {
  return formatter.format(new Date(date));
}

module.exports = { recordVisit, dayKey, dayOf };
