const express = require("express");
const router = express.Router();

const c = require("../controllers/adoptionPickupController");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const validateRequest = require("../middleware/validateRequest");
const {
  adoptionPickupCreateSchema,
  adoptionPickupUpdateSchema,
  adoptionPickupCompleteSchema,
  adoptionPickupCancelSchema,
} = require("../validators/adoptionPickup.schema");

router.get("/my", protect, c.myPickups);
router.post("/", protect, adminOnly, validateRequest(adoptionPickupCreateSchema), c.create);
router.get("/", protect, adminOnly, c.list);
router.get("/:id", protect, c.getOne);
router.put("/:id", protect, adminOnly, validateRequest(adoptionPickupUpdateSchema), c.update);
router.put("/:id/complete", protect, adminOnly, validateRequest(adoptionPickupCompleteSchema), c.complete);
router.put("/:id/cancel", protect, adminOnly, validateRequest(adoptionPickupCancelSchema), c.cancel);
router.put("/:id/no-show", protect, adminOnly, c.noShow);

module.exports = router;
