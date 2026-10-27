const express = require("express");
const router = express.Router();

const c = require("../controllers/inKindDonationController");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const validateRequest = require("../middleware/validateRequest");
const { uploadImage } = require("../middleware/uploadMiddleware");
const { inKindDonationCreateSchema, inKindDonationStatusSchema } = require("../validators/inKindDonation.schema");

router.post("/", protect, uploadImage.array("photos", 5), validateRequest(inKindDonationCreateSchema), c.create);
router.get("/my", protect, c.myDonations);
router.get("/", protect, adminOnly, c.list);
router.patch("/:id/status", protect, adminOnly, validateRequest(inKindDonationStatusSchema), c.updateStatus);
router.delete("/:id", protect, adminOnly, c.remove);
router.post("/:id/restore", protect, adminOnly, c.restore);

module.exports = router;
