#!/usr/bin/env node
/**
 * One-off backfill for accounts created before email verification was
 * enforced (requireVerifiedEmail). NOT run automatically.
 *
 * Cohort: member accounts (role "user"), not deleted, emailVerified === false,
 * with at least one successful login before --cutoff.
 *
 *   --mode=verify   mark the cohort as verified (no email is sent)
 *   --mode=email    send each cohort member a fresh verification email
 *   --cutoff=DATE   ISO date/time; only users who logged in before it
 *   --apply         actually write/send. Without it, nothing changes (dry run)
 *
 * Examples:
 *   node scripts/backfill-email-verification.js --mode=verify --cutoff=2026-10-20
 *   node scripts/backfill-email-verification.js --mode=email  --cutoff=2026-10-20 --apply
 *
 * Output contains counts and user ids only, never emails or tokens.
 */
/* eslint-disable no-console */
require("dotenv").config();
const { setTimeout: sleep } = require("timers/promises");
const mongoose = require("mongoose");

const User = require("../src/models/User");
const LoginHistory = require("../src/models/LoginHistory");

function parseArgs(argv) {
  const args = { apply: false };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg.startsWith("--mode=")) args.mode = arg.slice(7);
    else if (arg.startsWith("--cutoff=")) args.cutoff = arg.slice(9);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["verify", "email"].includes(args.mode)) throw new Error("--mode=verify|email is required");
  const cutoff = new Date(args.cutoff);
  if (!args.cutoff || Number.isNaN(cutoff.getTime())) throw new Error("--cutoff=<ISO date> is required and must be a valid date");
  args.cutoff = cutoff;
  return args;
}

async function findCohort(cutoff) {
  const loggedInIds = await LoginHistory.distinct("user", { success: true, createdAt: { $lt: cutoff }, user: { $ne: null } });
  return User.find({ _id: { $in: loggedInIds }, role: "user", emailVerified: false, isDeleted: { $ne: true } }).select("_id displayName email");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const cohort = await findCohort(args.cutoff);
    console.log(`${args.apply ? "APPLY" : "DRY RUN"} mode=${args.mode} cutoff=${args.cutoff.toISOString()} matched=${cohort.length}`);
    if (!args.apply) {
      console.log("No changes made. Re-run with --apply to proceed.");
      return;
    }

    if (args.mode === "verify") {
      const res = await User.updateMany(
        { _id: { $in: cohort.map((u) => u._id) } },
        { $set: { emailVerified: true }, $unset: { emailVerificationToken: "", emailVerificationExpires: "" } }
      );
      console.log(`Marked verified: ${res.modifiedCount}`);
      return;
    }

    const { issueVerificationEmail } = require("../src/utils/emailVerification");
    let sent = 0;
    let failed = 0;
    for (const user of cohort) {
      const result = await issueVerificationEmail(user);
      if (result.emailSent) sent += 1;
      else {
        failed += 1;
        console.warn(`Not sent: user=${user._id} reason=${result.reason}`);
      }
      await sleep(250); // be gentle with the SMTP provider
    }
    console.log(`Emails sent: ${sent}, failed/skipped: ${failed}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
