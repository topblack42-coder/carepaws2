const express = require("express");
const router = express.Router();

const applicationController = require("../controllers/applicationController");
const { protect, adminOnly, requireVerifiedEmail } = require("../middleware/authMiddleware");
const validateRequest = require("../middleware/validateRequest");
const {
  applicationCreateSchema,
  applicationStatusSchema,
  applicationStageSchema,
} = require("../validators/application.schema");
const { z } = require("zod");

router.get("/my", protect, applicationController.myApplications);
router.get("/", protect, adminOnly, applicationController.listApplications);
router.get("/:id", protect, applicationController.getApplication);
router.post("/", protect, requireVerifiedEmail, validateRequest(applicationCreateSchema), applicationController.createApplication);
router.delete("/:id", protect, adminOnly, applicationController.deleteApplication);
router.put("/:id/status", protect, adminOnly, validateRequest(applicationStatusSchema), applicationController.updateStatus);
router.put("/:id/stage", protect, adminOnly, validateRequest(applicationStageSchema), applicationController.updateStage);
router.get("/:id/notes", protect, adminOnly, applicationController.getNotes);
router.post(
  "/:id/notes",
  protect,
  adminOnly,
  validateRequest(z.object({ text: z.string().min(1).max(2000) }).strict()),
  applicationController.addNote
);

module.exports = router;
