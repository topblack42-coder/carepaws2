const express = require("express");
const router = express.Router();
const AuditLog = require("../models/AuditLog");
const { protect, requireRole } = require("../middleware/authMiddleware");
const { buildSort, buildPagination } = require("../utils/queryBuilder");

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
    const sort = buildSort(req.query);
    const total = await AuditLog.countDocuments(filter);
    const { page, limit, skip, ...paginationRest } = buildPagination(total, req.query.page, req.query.limit);
    const data = await AuditLog.find(filter).populate("actor", "displayName email").sort(sort).skip(skip).limit(limit);
    res.json({ success: true, data, pagination: { page, limit, ...paginationRest } });
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
