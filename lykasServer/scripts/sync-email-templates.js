#!/usr/bin/env node
/**
 * One-off: upserts the default "password_reset" and "verify_email" email
 * templates so their bodies contain a real clickable <a href> button plus the
 * raw link as plain text. Overwrites the stored subject/body of existing
 * templates (including admin edits to those two), so review the dry run first.
 * NOT run automatically. Safe to re-run (idempotent).
 *
 *   node scripts/sync-email-templates.js            # dry run, shows what would change
 *   node scripts/sync-email-templates.js --apply    # write to the database
 */
/* eslint-disable no-console */
require("dotenv").config();
const mongoose = require("mongoose");
const { syncEmailTemplates } = require("../src/utils/emailTemplateDefaults");

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--apply");
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  const apply = args.includes("--apply");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const results = await syncEmailTemplates({ apply });
    console.log(apply ? "APPLY" : "DRY RUN");
    for (const r of results) console.log(`${r.key}: ${r.action}${apply || r.action === "unchanged" ? "" : " (would change)"}`);
    if (!apply) console.log("No changes made. Re-run with --apply to proceed.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
