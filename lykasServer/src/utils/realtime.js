const mongoose = require("mongoose");
const logger = require("./logger");

/**
 * Real-time change feed.
 *
 * A global Mongoose plugin watches every model for writes (save, update,
 * delete, insertMany) and emits a tiny, data-free "data:changed" Socket.IO
 * event so clients can refetch whatever they are showing. Nothing sensitive
 * travels over the socket — only { resource, action, ids } — and the REST
 * API (with its auth + permission checks) stays the single source of data.
 *
 * Audience for each event:
 *   - staff_room         every staff/admin socket (receives ids)
 *   - owner rooms        the user ids found on the document / query filter
 *                        (applicant, user, recipient, ...) — no ids
 *   - everyone           for PUBLIC_MODELS (pet catalog, events, ...)
 *
 * Events are coalesced per resource for FLUSH_MS so bulk writes
 * (updateMany, cron jobs, insertMany) produce one event, not hundreds.
 *
 * installPlugin() MUST run before any model is compiled (see server.js).
 */

const STAFF_ROOM = "staff_room";
const FLUSH_MS = Number(process.env.REALTIME_FLUSH_MS) || 250;
const MAX_IDS = 50;

// High-volume or self-referential collections: emitting for these would
// create noise (every request writes an ApiLog) or feedback loops.
const IGNORED_MODELS = new Set([
  "ApiLog",
  "ErrorLog",
  "LoginHistory",
  "Session",
  "TokenBlacklist",
  "ScheduledJobLog",
  "DailyVisit", // written by the visit tracker, not user-facing data
  "Message", // chat has its own dedicated receiveMessage event
]);

// Content every signed-in user can browse; changes are broadcast to all.
const PUBLIC_MODELS = new Set(["Pet", "Event", "Announcement", "ContentItem"]);

// Fields that identify which user a document belongs to / concerns.
const OWNER_FIELDS = [
  "applicant",
  "user",
  "userId",
  "recipient",
  "submittedBy",
  "fosterer",
  "donatedBy",
  "paidBy",
  "owner",
  "assignedTo",
];

let io = null;
let installed = false;
const pending = new Map();

function setIo(instance) {
  io = instance;
}

function idOf(value) {
  if (!value) return null;
  if (typeof value === "string") return /^[a-f0-9]{24}$/i.test(value) ? value : null;
  if (value._id) return idOf(String(value._id));
  const str = typeof value.toString === "function" ? String(value) : "";
  return /^[a-f0-9]{24}$/i.test(str) ? str : null;
}

function ownersOf(source, resource) {
  const rooms = new Set();
  if (!source) return rooms;
  if (resource === "User") {
    const self = idOf(source._id);
    if (self) rooms.add(self);
  }
  for (const field of OWNER_FIELDS) {
    const raw = typeof source.get === "function" ? source.get(field) : source[field];
    const id = idOf(raw);
    if (id) rooms.add(id);
  }
  return rooms;
}

function flush(resource) {
  const entry = pending.get(resource);
  pending.delete(resource);
  if (!entry || !io) return;

  const base = {
    resource,
    action: entry.actions.size === 1 ? [...entry.actions][0] : "changed",
    at: Date.now(),
  };

  try {
    if (PUBLIC_MODELS.has(resource)) {
      io.emit("data:changed", { ...base, ids: [...entry.ids].slice(0, MAX_IDS) });
      return;
    }
    io.to(STAFF_ROOM).emit("data:changed", { ...base, ids: [...entry.ids].slice(0, MAX_IDS) });
    if (entry.rooms.size > 0) {
      // Owners get the signal without ids; staff were already served above.
      io.to([...entry.rooms]).except(STAFF_ROOM).emit("data:changed", base);
    }
  } catch (err) {
    logger.warn({ err, resource }, "Failed to emit realtime event");
  }
}

function record(resource, action, ids, rooms) {
  if (!io || !resource || IGNORED_MODELS.has(resource)) return;

  let entry = pending.get(resource);
  if (!entry) {
    entry = { ids: new Set(), actions: new Set(), rooms: new Set() };
    pending.set(resource, entry);
    const timer = setTimeout(() => flush(resource), FLUSH_MS);
    if (typeof timer.unref === "function") timer.unref();
  }
  entry.actions.add(action);
  for (const id of ids) entry.ids.add(id);
  for (const room of rooms) entry.rooms.add(room);
}

function track(resource, action, doc, filter) {
  try {
    const ids = [];
    const rooms = ownersOf(doc, resource);
    const docId = doc && idOf(doc._id);
    if (docId) ids.push(docId);
    if (filter) {
      for (const room of ownersOf(filter, resource)) rooms.add(room);
      const filterId = idOf(filter._id);
      if (filterId) ids.push(filterId);
    }
    record(resource, action, ids, rooms);
  } catch (err) {
    logger.debug({ err }, "realtime track failed");
  }
}

function realtimePlugin(schema) {
  schema.post("save", function (doc) {
    track(doc?.constructor?.modelName, "saved", doc);
  });

  schema.post("insertMany", function (docs) {
    const resource = this?.modelName;
    for (const doc of Array.isArray(docs) ? docs : []) track(resource, "saved", doc);
  });

  for (const op of ["findOneAndUpdate", "findOneAndReplace", "findOneAndDelete"]) {
    const action = op === "findOneAndDelete" ? "deleted" : "updated";
    schema.post(op, function (doc) {
      if (doc) track(this?.model?.modelName, action, doc);
    });
  }

  for (const op of ["updateOne", "updateMany", "replaceOne"]) {
    schema.post(op, { document: false, query: true }, function () {
      if (typeof this?.getFilter !== "function") return; // document-level call
      track(this?.model?.modelName, "updated", null, this.getFilter());
    });
  }

  for (const op of ["deleteOne", "deleteMany"]) {
    schema.post(op, { document: false, query: true }, function () {
      if (typeof this?.getFilter !== "function") return; // document-level call
      track(this?.model?.modelName, "deleted", null, this.getFilter());
    });
  }
  schema.post("deleteOne", { document: true, query: false }, function (doc) {
    if (typeof this?.getFilter === "function") return; // query-level call
    track(doc?.constructor?.modelName, "deleted", doc);
  });
}

function installPlugin() {
  if (installed) return;
  installed = true;
  mongoose.plugin(realtimePlugin);
}

module.exports = {
  STAFF_ROOM,
  setIo,
  installPlugin,
  realtimePlugin,
  // exported for unit tests
  _internals: { idOf, ownersOf, record, flush, pending },
};
