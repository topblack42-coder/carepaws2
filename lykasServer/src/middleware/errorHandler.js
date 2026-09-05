const logger = require("../utils/logger");
const ErrorLog = require("../models/ErrorLog");

function notFoundHandler(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Mongoose throws CastError when an :id route param isn't a valid
  // ObjectId (e.g. GET /api/pets/not-a-real-id) — this affects roughly
  // 83 findById/findOne-by-id call sites across the controllers, only
  // one of which (archiveRoutes.js) had its own guard against it.
  // Left unhandled, this surfaced as a generic, unhelpful "Internal
  // server error" (500) for what's actually just a bad request (400).
  // Handling it once here, centrally, fixes every call site at once
  // instead of requiring an ObjectId.isValid() check to be added to
  // each of them individually.
  if (err.name === "CastError" && err.kind === "ObjectId") {
    return res.status(400).json({ success: false, message: `Invalid id: ${err.value}`, requestId: req.requestId });
  }
  // Similarly, a Mongoose-level ValidationError (a schema constraint
  // failing on .save(), distinct from the Zod request-body validation
  // most routes already do) is a client-fixable 400, not a genuine
  // server fault — without this, it would also default to a 500 below.
  if (err.name === "ValidationError" && err.errors) {
    const message = Object.values(err.errors).map((e) => e.message).join(", ");
    return res.status(400).json({ success: false, message, requestId: req.requestId });
  }

  const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;

  logger.error({ err, requestId: req.requestId, path: req.originalUrl, method: req.method }, err.message);

  ErrorLog.create({
    source: "server",
    message: err.message,
    stack: err.stack,
    route: req.originalUrl,
    method: req.method,
    statusCode,
    userId: req.user?._id || null,
    severity: statusCode >= 500 ? "error" : "warning",
    metadata: { requestId: req.requestId },
  }).catch((logErr) => logger.error({ logErr }, "Failed to write ErrorLog entry"));

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? "Internal server error" : err.message,
    requestId: req.requestId,
  });
}

module.exports = { notFoundHandler, errorHandler };
