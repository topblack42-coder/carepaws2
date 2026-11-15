const express = require("express");
const router = express.Router();

const fosterController = require("../controllers/fosterController");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const validateRequest = require("../middleware/validateRequest");
const { fosterCreateSchema, fosterEndSchema, fosterExtendSchema, returnRequestSchema, emergencyContactSchema, weeklyReportSchema } = require("../validators/foster.schema");

router.get("/reports/pending-review", protect, adminOnly, fosterController.pendingReports);
router.put("/reports/:reportId/review", protect, adminOnly, fosterController.reviewReport);
router.get("/my", protect, fosterController.myFosters);
router.post("/", protect, adminOnly, validateRequest(fosterCreateSchema), fosterController.create);
router.get("/", protect, adminOnly, fosterController.list);
router.get("/:id", protect, fosterController.getOne);
router.put("/:id", protect, adminOnly, fosterController.update);
router.put("/:id/end", protect, adminOnly, validateRequest(fosterEndSchema), fosterController.end);
router.put("/:id/extend", protect, adminOnly, validateRequest(fosterExtendSchema), fosterController.extend);
router.post("/:id/return-request", protect, validateRequest(returnRequestSchema), fosterController.requestReturn);
router.put("/:id/emergency-contact", protect, validateRequest(emergencyContactSchema), fosterController.setEmergencyContact);
router.put("/:id/cancel", protect, adminOnly, fosterController.cancel);
router.get("/:id/can-finalize", protect, adminOnly, fosterController.canFinalize);
router.post("/:fosterId/reports", protect, validateRequest(weeklyReportSchema), fosterController.addReport);
router.get("/:fosterId/reports", protect, fosterController.listReports);
router.get("/:fosterId/reports/missing", protect, adminOnly, fosterController.missingReports);

module.exports = router;
