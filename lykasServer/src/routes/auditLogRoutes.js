const express = require("express");
const router = express.Router();
const AuditLog = require("../models/AuditLog");
const { protect, requireRole } = require("../middleware/authMiddleware");
const { buildSort, buildPagination } = require("../utils/queryBuilder");
const User = require("../models/User");
const Application = require("../models/Application");
const Pet = require("../models/Pet");
const Volunteer = require("../models/Volunteer");
const InKindDonation = require("../models/InKindDonation");
const { actionLabel, actionsMatching, describeEntries } = require("../utils/auditDescriptions");

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Free-text search: matches the plain-English action name, the staff member
// who did it, or the person it affected.
async function buildSearchFilter(q) {
  const text = String(q).trim();
  if (!text) return null;
  const rx = new RegExp(escapeRegex(text), "i");
  const people = await User.find({ $or: [{ displayName: rx }, { email: rx }] }).select("_id").limit(200).lean();
  const ids = people.map((u) => u._id);
  const [apps, vols, dons] = ids.length
    ? await Promise.all([
        Application.find({ applicant: { $in: ids } }).select("_id").lean(),
        Volunteer.find({ user: { $in: ids } }).select("_id").lean(),
        InKindDonation.find({ donatedBy: { $in: ids } }).select("_id").lean(),
      ])
    : [[], [], []];
  const pets = await Pet.find({ name: rx }).select("_id").limit(200).lean();
  const petApps = pets.length ? await Application.find({ pet: { $in: pets.map((p) => p._id) } }).select("_id").lean() : [];
  const entityIds = [
    ...ids,
    ...apps.map((a) => a._id),
    ...vols.map((v) => v._id),
    ...dons.map((d) => d._id),
    ...pets.map((p) => p._id),
    ...petApps.map((a) => a._id),
  ];
  const or = [{ action: { $in: actionsMatching(text) } }, { action: rx }];
  if (ids.length) or.push({ actor: { $in: ids } }, { targetUser: { $in: ids } });
  if (entityIds.length) or.push({ entityId: { $in: entityIds } });
  return { $or: or };
}

router.get("/actions", protect, requireRole("super_admin"), async (req, res, next) => {
  try {
    const actions = await AuditLog.distinct("action");
    res.json({ success: true, data: actions });
  } catch (err) {
    next(err);
  }
});

router.get("/", protect, requireRole("super_admin"), async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.entityType) filter.entityType = req.query.entityType;
    if (req.query.actor) filter.actor = req.query.actor;
    if (req.query.q) {
      const search = await buildSearchFilter(req.query.q);
      if (search) Object.assign(filter, search);
    }
    const sort = buildSort(req.query);
    const total = await AuditLog.countDocuments(filter);
    const { page, limit, skip, ...paginationRest } = buildPagination(total, req.query.page, req.query.limit);
    const data = await AuditLog.find(filter).populate("actor", "displayName email").sort(sort).skip(skip).limit(limit).lean();
    const details = await describeEntries(data);
    const rows = data.map((entry) => ({
      ...entry,
      actionLabel: actionLabel(entry.action),
      ...details.get(String(entry._id)),
    }));
    res.json({ success: true, data: rows, pagination: { page, limit, ...paginationRest } });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", protect, requireRole("super_admin"), async (req, res, next) => {
  try {
    const entry = await AuditLog.findById(req.params.id).populate("actor targetUser");
    if (!entry) return res.status(404).json({ success: false, message: "Audit log entry not found" });
    res.json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
