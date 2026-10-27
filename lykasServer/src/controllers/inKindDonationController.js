const InKindDonation = require("../models/InKindDonation");
const InventoryItem = require("../models/InventoryItem");
const { buildListQuery, buildSort, buildPagination } = require("../utils/queryBuilder");
const { writeAuditLog } = require("../utils/auditLogger");
const { findInventoryItem, normalizeName, applyDonationMovement } = require("../utils/inventoryService");
const { notifyOnce } = require("../utils/notificationHelper");
const cloudinary = require("../config/cloudinary");
const { PRIVACY_POLICY_VERSION } = require("../config/privacy");

function uploadPhoto(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: "carepaws/goods-donations", resource_type: "image" }, (err, result) =>
      err ? reject(err) : resolve(result.secure_url)
    );
    stream.end(buffer);
  });
}

function donationLines(donation) {
  if (Array.isArray(donation.items) && donation.items.length) {
    return donation.items
      .map((item) => ({ name: String(item.name || "").trim(), quantity: Number(item.quantity || 0), unit: item.unit || "" }))
      .filter((item) => item.name && item.quantity > 0);
  }
  if (donation.name && Number(donation.quantity || 0) > 0) {
    return [{ name: donation.name.trim(), quantity: Number(donation.quantity), unit: donation.unit || "" }];
  }
  return [];
}

async function integrateReceivedDonation(donation, actor) {
  const lines = donationLines(donation);
  if (!lines.length) return [];

  const grouped = new Map();
  for (const line of lines) {
    const key = `${normalizeName(line.name)}\u0000${String(line.unit || "").trim().toLowerCase()}`;
    const existing = grouped.get(key);
    if (existing) existing.quantity += line.quantity;
    else grouped.set(key, { ...line });
  }

  const prepared = [];
  for (const line of grouped.values()) {
    let item = await findInventoryItem(line.name);
    if (!item) {
      item = await InventoryItem.create({
        name: line.name,
        normalizedName: normalizeName(line.name),
        category: "other",
        quantity: 0,
        unit: line.unit || undefined,
        movements: [],
      });
    } else if (item.unit && line.unit && item.unit.trim().toLowerCase() !== line.unit.trim().toLowerCase()) {
      const err = new Error(`Donation unit for ${line.name} does not match the inventory unit`);
      err.statusCode = 409;
      throw err;
    } else if (!item.unit && line.unit) {
      item.unit = line.unit;
      await item.save();
    }
    prepared.push({ item, line });
  }

  const appliedMovementIds = [];
  for (const { item, line } of prepared) {
    const result = await applyDonationMovement({
      item,
      quantity: line.quantity,
      donationId: donation._id,
      actor,
      note: `In-kind donation ${donation._id}`,
    });
    const movement = result.item?.movements?.find(
      (entry) => String(entry.sourceId || "") === String(donation._id) && entry.sourceType === "inkind_donation"
    );
    if (movement) appliedMovementIds.push(movement._id);
  }

  return appliedMovementIds;
}

async function create(req, res, next) {
  try {
    const { acceptedTerms, ...fields } = req.body;
    const photos = req.files?.length ? await Promise.all(req.files.map((file) => uploadPhoto(file.buffer))) : [];
    // Walk-in donors drop goods off themselves, so no pickup address is kept.
    if (fields.dropOff === "walk_in") delete fields.pickupAddress;
    const donation = await InKindDonation.create({
      ...fields,
      photos,
      donatedBy: req.user._id,
      privacyAccepted: true,
      privacyAcceptedAt: new Date(),
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    });
    return res.status(201).json({ success: true, data: donation });
  } catch (err) {
    next(err);
  }
}

async function myDonations(req, res, next) {
  try {
    const data = await InKindDonation.find({ donatedBy: req.user._id }).sort({ createdAt: -1 });
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const filter = buildListQuery(req.query, { filterFields: ["status", "dropOff"], allowIncludeDeleted: true });
    const sort = buildSort(req.query);
    const total = await InKindDonation.countDocuments(filter);
    const { page, limit, skip, ...paginationRest } = buildPagination(total, req.query.page, req.query.limit);
    const data = await InKindDonation.find(filter).populate("donatedBy", "displayName email").sort(sort).skip(skip).limit(limit);
    return res.json({ success: true, data, pagination: { page, limit, ...paginationRest } });
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const donation = await InKindDonation.findById(req.params.id);
    if (!donation) return res.status(404).json({ success: false, message: "Donation not found" });

    const nextStatus = req.body.status;
    const currentStatus = donation.status;
    if (currentStatus === "received" && nextStatus !== "received") {
      return res.status(409).json({ success: false, message: "A received donation cannot be moved back to another status after inventory has been updated" });
    }
    if (currentStatus === "cancelled" && nextStatus !== "cancelled") {
      return res.status(409).json({ success: false, message: "A cancelled donation cannot be received or confirmed" });
    }

    if (nextStatus === "received") {
      await integrateReceivedDonation(donation, req.user._id);
      donation.inventoryProcessedAt = donation.inventoryProcessedAt || new Date();
      donation.receivedAt = donation.receivedAt || new Date();
    }

    donation.status = nextStatus;
    if (req.body.staffNote !== undefined) donation.staffNote = req.body.staffNote;
    await donation.save();

    await writeAuditLog({ actor: req.user._id, action: "inkind_donation.status_update", entityType: "InKindDonation", entityId: donation._id, req });

    if (currentStatus !== nextStatus && donation.donatedBy) {
      await notifyOnce({
        recipient: donation.donatedBy,
        sender: req.user._id,
        type: "IN_KIND_DONATION_STATUS",
        title: "Donation status updated",
        message: `Your in-kind donation is now ${nextStatus}.`,
        refModel: "InKindDonation",
        refId: donation._id,
        dedupeKey: `inkind-donation:${donation._id}:status:${nextStatus}`,
      });
    }

    return res.json({ success: true, data: donation });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const donation = await InKindDonation.findById(req.params.id);
    if (!donation) return res.status(404).json({ success: false, message: "Donation not found" });
    if (donation.status === "received") return res.status(409).json({ success: false, message: "Received donations cannot be deleted after inventory has been updated" });

    donation.isDeleted = true;
    donation.deletedAt = new Date();
    donation.deletedBy = req.user._id;
    await donation.save();

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function restore(req, res, next) {
  try {
    const donation = await InKindDonation.findOneAndUpdate(
      { _id: req.params.id, isDeleted: true },
      { isDeleted: false, deletedAt: null, deletedBy: null },
      { new: true }
    );
    if (!donation) return res.status(404).json({ success: false, message: "Deleted donation not found" });
    return res.json({ success: true, data: donation });
  } catch (err) {
    next(err);
  }
}

module.exports = { create, myDonations, list, updateStatus, remove, restore };
