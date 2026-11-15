const express = require("express");
const router = express.Router();
const cloudinary = require("../config/cloudinary");
const BabyBook = require("../models/BabyBook");
const Pet = require("../models/Pet");
const { protect } = require("../middleware/authMiddleware");
const validateRequest = require("../middleware/validateRequest");
const { uploadImage } = require("../middleware/uploadMiddleware");
const { babyBookCreateSchema, babyBookUpdateSchema } = require("../validators/babyBook.schema");

function uploadBufferToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

const STAFF_ROLES = ["staff", "admin", "super_admin"];

function isStaff(user) {
  return STAFF_ROLES.includes(user.role);
}

function ownsPet(pet, user) {
  // The adoption owner, or the fosterer while the pet is in their care.
  return Boolean(pet && ((pet.owner && pet.owner.equals(user._id)) || (pet.currentFosterer && pet.currentFosterer.equals(user._id))));
}

// Staff can view any pet's baby book (shelter/foster oversight); everyone
// else only their own pet's, matching the ownership model used by /my below.
async function canAccessPet(user, petId) {
  const pet = await Pet.findById(petId).select("owner currentFosterer");
  if (!pet) return false;
  return isStaff(user) || ownsPet(pet, user);
}

router.get("/my", protect, async (req, res, next) => {
  try {
    const myPets = await Pet.find({ $or: [{ owner: req.user._id }, { currentFosterer: req.user._id }] }).select("_id");
    const entries = await BabyBook.find({ pet: { $in: myPets.map((p) => p._id) } }).sort({ date: -1 });
    res.json({ success: true, data: entries });
  } catch (err) {
    next(err);
  }
});

router.get("/entry/:id", protect, async (req, res, next) => {
  try {
    const entry = await BabyBook.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Entry not found" });
    if (!(await canAccessPet(req.user, entry.pet))) {
      return res.status(404).json({ success: false, message: "Entry not found" });
    }
    res.json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
});

// uploadImage.single("photo") is a no-op when the request isn't
// multipart/form-data, so this stays backward-compatible with plain
// JSON entries (text-only) as well as FormData ones that include a photo.
router.post("/", protect, uploadImage.single("photo"), validateRequest(babyBookCreateSchema), async (req, res, next) => {
  try {
    const pet = await Pet.findById(req.body.pet).select("owner currentFosterer");
    if (!pet) return res.status(404).json({ success: false, message: "Pet not found" });
    if (!isStaff(req.user) && !ownsPet(pet, req.user)) {
      return res.status(403).json({ success: false, message: "You can only add baby book entries for your own pets" });
    }

    let photoUrl = null;
    if (req.file) {
      const result = await uploadBufferToCloudinary(req.file.buffer, "carepaws/baby-book");
      photoUrl = result.secure_url;
    }

    const entry = await BabyBook.create({ ...req.body, photoUrl, addedBy: req.user._id });
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
});

router.put("/entry/:id", protect, uploadImage.single("photo"), validateRequest(babyBookUpdateSchema), async (req, res, next) => {
  try {
    const entry = await BabyBook.findOne({ _id: req.params.id, addedBy: req.user._id });
    if (!entry) return res.status(404).json({ success: false, message: "Entry not found" });

    if (req.file) {
      const result = await uploadBufferToCloudinary(req.file.buffer, "carepaws/baby-book");
      entry.photoUrl = result.secure_url;
    }

    Object.assign(entry, req.body);
    await entry.save();
    res.json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
});

router.delete("/entry/:id", protect, async (req, res, next) => {
  try {
    const entry = await BabyBook.findOneAndDelete({ _id: req.params.id, addedBy: req.user._id });
    if (!entry) return res.status(404).json({ success: false, message: "Entry not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/:petId", protect, async (req, res, next) => {
  try {
    if (!(await canAccessPet(req.user, req.params.petId))) {
      return res.status(404).json({ success: false, message: "Pet not found" });
    }
    const entries = await BabyBook.find({ pet: req.params.petId }).sort({ date: -1 });
    res.json({ success: true, data: entries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
