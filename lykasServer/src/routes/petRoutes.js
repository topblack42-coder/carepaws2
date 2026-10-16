const express = require("express");
const router = express.Router();

const petController = require("../controllers/petController");
const { protect, adminOnly, requireRole } = require("../middleware/authMiddleware");
const validateRequest = require("../middleware/validateRequest");
const { uploadPetMedia } = require("../middleware/uploadMiddleware");
const { petCreateSchema, petUpdateSchema } = require("../validators/pet.schema");

router.get("/", petController.listPets);
router.get("/admin", protect, adminOnly, petController.listPetsAdmin);
router.get("/my-pets", protect, petController.myPets);
router.get("/:id", petController.getPet);

router.post(
  "/",
  protect,
  adminOnly,
  uploadPetMedia,
  validateRequest(petCreateSchema),
  petController.createPet
);

router.put(
  "/:id",
  protect,
  adminOnly,
  uploadPetMedia,
  validateRequest(petUpdateSchema),
  petController.updatePet
);

router.delete("/:id/video", protect, adminOnly, petController.removePetVideo);

router.delete("/:id", protect, adminOnly, petController.deletePet);
router.post("/:id/restore", protect, adminOnly, petController.restorePet);
router.delete("/:id/permanent", protect, requireRole("super_admin"), petController.permanentlyDeletePet);

module.exports = router;
