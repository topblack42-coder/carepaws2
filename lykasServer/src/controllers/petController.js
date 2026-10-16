const cloudinary = require("../config/cloudinary");
const Pet = require("../models/Pet");
const { buildListQuery, buildSort, buildPagination } = require("../utils/queryBuilder");
const { writeAuditLog } = require("../utils/auditLogger");
const { assertShelterAssignmentAllowed } = require("../utils/shelterOccupancy");
const { VideoUploadError, uploadPetVideo, destroyVideo, releaseVideoAsset } = require("../utils/petVideoService");

const SEARCH_FIELDS = ["name", "breed", "description"];
const FILTER_FIELDS = ["status", "species", "gender", "size", "temperament", "energyLevel"];

function uploadBufferToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

// multer .fields() puts files under req.files.{image,video}; each is optional.
function getUploadedFiles(req) {
  const files = req.files || {};
  return { imageFile: files.image && files.image[0], videoFile: files.video && files.video[0] };
}

// Video problems (too long, wrong codec, storage down...) are the admin's
// to fix or retry, so they get their real status and message rather than
// the generic 500 the central error handler would mask them with.
function sendVideoError(err, res) {
  return res.status(err.statusCode).json({ success: false, message: err.message });
}

// GET /api/pets — public list
async function listPets(req, res, next) {
  try {
    const filter = buildListQuery(req.query, { searchFields: SEARCH_FIELDS, filterFields: FILTER_FIELDS, allowIncludeDeleted: false });
    filter.status = filter.status || "Available"; // public catalog defaults to Available unless a status filter was given
    if (req.query.status) filter.status = req.query.status;

    const sort = buildSort(req.query);
    const { page, limit, skip, ...paginationRest } = buildPagination(
      await Pet.countDocuments(filter),
      req.query.page,
      req.query.limit
    );

    const data = await Pet.find(filter).sort(sort).skip(skip).limit(limit);

    return res.json({ success: true, data, pagination: { page, limit, ...paginationRest } });
  } catch (err) {
    next(err);
  }
}

// GET /api/pets/admin — full filtered/paginated list incl. adopted/foster/deleted
async function listPetsAdmin(req, res, next) {
  try {
    const filter = buildListQuery(req.query, { searchFields: SEARCH_FIELDS, filterFields: FILTER_FIELDS, allowIncludeDeleted: true });
    const sort = buildSort(req.query);
    const total = await Pet.countDocuments(filter);
    const { page, limit, skip, ...paginationRest } = buildPagination(total, req.query.page, req.query.limit);

    const data = await Pet.find(filter).sort(sort).skip(skip).limit(limit);

    return res.json({ success: true, data, pagination: { page, limit, ...paginationRest } });
  } catch (err) {
    next(err);
  }
}

// GET /api/pets/:id
async function getPet(req, res, next) {
  try {
    const pet = await Pet.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!pet) return res.status(404).json({ success: false, message: "Pet not found" });
    return res.json({ success: true, data: pet });
  } catch (err) {
    next(err);
  }
}

// POST /api/pets — admin, multipart: optional `image` and optional `video`
async function createPet(req, res, next) {
  let video = null;
  let pet = null;
  try {
    let imageUrl = null;
    const { imageFile, videoFile } = getUploadedFiles(req);
    if (req.body.shelterId) await assertShelterAssignmentAllowed(req.body.shelterId);

    if (videoFile) video = await uploadPetVideo(videoFile);

    if (imageFile) {
      const result = await uploadBufferToCloudinary(imageFile.buffer, "carepaws/pets");
      imageUrl = result.secure_url;
    }

    pet = await Pet.create({ ...req.body, imageUrl, video });

    await writeAuditLog({
      actor: req.user._id,
      action: "pet.create",
      entityType: "Pet",
      entityId: pet._id,
      newValues: pet.toObject(),
      req,
    });

    return res.status(201).json({ success: true, data: pet });
  } catch (err) {
    // Don't leave an orphaned upload behind if the pet was never created.
    if (video && !pet) await destroyVideo(video.publicId);
    if (err instanceof VideoUploadError) return sendVideoError(err, res);
    next(err);
  }
}

// PUT /api/pets/:id
async function updatePet(req, res, next) {
  try {
    const pet = await Pet.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!pet) return res.status(404).json({ success: false, message: "Pet not found" });

    const previousValues = pet.toObject();

    // Owner and status are meant to stay in sync: Adopted/Foster pets
    // should have an owner, Available/Pending pets should not. The normal
    // path for changing this is the applications workflow (which keeps
    // both in lockstep — see applicationController), but this direct
    // admin edit can also change status, so guard against leaving the
    // pair in an inconsistent/impossible state.
    if (req.body.status && req.body.status !== pet.status) {
      const nextStatus = req.body.status;
      if ((nextStatus === "Adopted" || nextStatus === "Foster") && !pet.owner) {
        return res.status(409).json({
          success: false,
          message: `Cannot mark this pet as ${nextStatus} without an assigned owner. Use the adoption/foster application workflow to assign one.`,
        });
      }
      if (nextStatus === "Available" || nextStatus === "Pending") {
        pet.owner = null;
      }
    }

    const nextShelterId = Object.prototype.hasOwnProperty.call(req.body, "shelterId") ? req.body.shelterId : pet.shelterId;
    if (nextShelterId && String(nextShelterId) !== String(pet.shelterId || "")) {
      await assertShelterAssignmentAllowed(nextShelterId, pet._id);
    }

    // The existing video is only touched when a new one is uploaded here
    // or removed via DELETE /api/pets/:id/video — omitting `video` from an
    // ordinary edit leaves it exactly as it was.
    const { imageFile, videoFile } = getUploadedFiles(req);
    const previousVideo = pet.video ? { ...pet.video.toObject() } : null;
    let newVideo = null;
    let saved = false;
    try {
      if (videoFile) newVideo = await uploadPetVideo(videoFile);

      if (imageFile) {
        const result = await uploadBufferToCloudinary(imageFile.buffer, "carepaws/pets");
        pet.imageUrl = result.secure_url;
      }

      Object.assign(pet, req.body);
      if (newVideo) pet.video = newVideo;
      await pet.save();
      saved = true;
    } finally {
      // Upload or save failed: drop the new file; the old video is untouched.
      if (newVideo && !saved) await destroyVideo(newVideo.publicId);
    }

    // Only after the pet points at the new video is the old file released.
    if (newVideo && previousVideo) await releaseVideoAsset(previousVideo);

    await writeAuditLog({
      actor: req.user._id,
      action: "pet.update",
      entityType: "Pet",
      entityId: pet._id,
      previousValues,
      newValues: pet.toObject(),
      req,
    });

    return res.json({ success: true, data: pet });
  } catch (err) {
    if (err instanceof VideoUploadError) return sendVideoError(err, res);
    next(err);
  }
}

// DELETE /api/pets/:id/video — explicit removal; the pet, its photo and all
// other data are left untouched. Idempotent: a pet with no video returns 200.
async function removePetVideo(req, res, next) {
  try {
    const pet = await Pet.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!pet) return res.status(404).json({ success: false, message: "Pet not found" });

    if (!pet.video) return res.json({ success: true, data: pet });

    const previousVideo = { ...pet.video.toObject() };
    pet.video = null;
    await pet.save();

    await releaseVideoAsset(previousVideo);

    await writeAuditLog({
      actor: req.user._id,
      action: "pet.video.remove",
      entityType: "Pet",
      entityId: pet._id,
      previousValues: { video: previousVideo },
      newValues: { video: null },
      req,
    });

    return res.json({ success: true, data: pet });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/pets/:id — soft delete
async function deletePet(req, res, next) {
  try {
    const pet = await Pet.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!pet) return res.status(404).json({ success: false, message: "Pet not found" });

    pet.isDeleted = true;
    pet.deletedAt = new Date();
    pet.deletedBy = req.user._id;
    await pet.save();

    await writeAuditLog({ actor: req.user._id, action: "pet.delete", entityType: "Pet", entityId: pet._id, req });

    return res.json({ success: true, message: "Pet archived" });
  } catch (err) {
    next(err);
  }
}

// POST /api/pets/:id/restore
async function restorePet(req, res, next) {
  try {
    const pet = await Pet.findOne({ _id: req.params.id, isDeleted: true });
    if (!pet) return res.status(404).json({ success: false, message: "Deleted pet not found" });

    pet.isDeleted = false;
    pet.deletedAt = null;
    pet.deletedBy = null;
    await pet.save();

    await writeAuditLog({ actor: req.user._id, action: "pet.restore", entityType: "Pet", entityId: pet._id, req });

    return res.json({ success: true, data: pet });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/pets/:id/permanent — super_admin only
async function permanentlyDeletePet(req, res, next) {
  try {
    const pet = await Pet.findByIdAndDelete(req.params.id);
    if (!pet) return res.status(404).json({ success: false, message: "Pet not found" });

    if (pet.video) await releaseVideoAsset(pet.video);

    await writeAuditLog({ actor: req.user._id, action: "pet.permanent_delete", entityType: "Pet", entityId: pet._id, req });

    return res.json({ success: true, message: "Pet permanently deleted" });
  } catch (err) {
    next(err);
  }
}

// GET /api/pets/my-pets — pets the current user owns
async function myPets(req, res, next) {
  try {
    const pets = await Pet.find({ owner: req.user._id, isDeleted: { $ne: true } });
    return res.json({ success: true, data: pets });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPets,
  listPetsAdmin,
  getPet,
  createPet,
  updatePet,
  removePetVideo,
  deletePet,
  restorePet,
  permanentlyDeletePet,
  myPets,
};
