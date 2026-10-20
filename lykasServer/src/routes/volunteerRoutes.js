const express = require("express");
const router = express.Router();

const volunteerController = require("../controllers/volunteerController");
const { protect, adminOnly, requireVerifiedEmail } = require("../middleware/authMiddleware");
const validateRequest = require("../middleware/validateRequest");
const { volunteerRegisterSchema, volunteerStatusSchema, logHoursSchema } = require("../validators/volunteer.schema");

router.post("/register", protect, requireVerifiedEmail, validateRequest(volunteerRegisterSchema), volunteerController.register);
router.get("/me", protect, volunteerController.myProfile);
router.put("/me", protect, validateRequest(volunteerRegisterSchema.partial()), volunteerController.updateMyProfile);
router.get("/", protect, adminOnly, volunteerController.list);
router.get("/:id", protect, adminOnly, volunteerController.getOne);
router.put("/:id/status", protect, adminOnly, validateRequest(volunteerStatusSchema), volunteerController.updateStatus);
router.post("/:id/hours", protect, adminOnly, validateRequest(logHoursSchema), volunteerController.logHours);
router.delete("/:id", protect, adminOnly, volunteerController.remove);
router.post("/:id/restore", protect, adminOnly, volunteerController.restore);

module.exports = router;
