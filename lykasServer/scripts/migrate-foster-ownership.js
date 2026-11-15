#!/usr/bin/env node
/**
 * One-off migration for the foster ownership split. NOT run automatically.
 *
 * Before this change, approving a foster application made the fosterer the
 * pet's `owner`. Now `owner` is the adoption owner only and a foster is the
 * `currentFosterer`. This moves every pet that is currently in foster care
 * (status "Foster") from `owner` to `currentFosterer`, leaving `owner` empty
 * (the shelter keeps the animal until an adoption is finalized).
 *
 *   --apply   actually write. Without it, nothing changes (dry run)
 *
 * Example:
 *   node scripts/migrate-foster-ownership.js          # preview
 *   node scripts/migrate-foster-ownership.js --apply
 *
 * Safe to re-run: pets that already have a currentFosterer are skipped.
 * Output contains counts and pet ids only.
 */
/* eslint-disable no-console */
require("dotenv").config();
const mongoose = require("mongoose");
const Pet = require("../src/models/Pet");

async function main() {
  const apply = process.argv.includes("--apply");
  const unknown = process.argv.slice(2).filter((a) => a !== "--apply");
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const filter = { status: "Foster", owner: { $ne: null }, currentFosterer: null };
    const pets = await Pet.find(filter).select("_id");
    console.log(`${apply ? "APPLY" : "DRY RUN"} pets to migrate: ${pets.length}`);
    for (const pet of pets) console.log(` - ${pet._id}`);
    if (!apply) {
      console.log("No changes made. Re-run with --apply to proceed.");
      return;
    }
    // Pipeline update: copy owner into currentFosterer, then clear owner, in one atomic step per document.
    const res = await Pet.collection.updateMany(filter, [{ $set: { currentFosterer: "$owner", owner: null } }]);
    console.log(`Migrated ${res.modifiedCount} pets.`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
