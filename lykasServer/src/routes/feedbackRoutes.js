const express = require("express");
const router = express.Router();
const Feedback = require("../models/Feedback");
const Application = require("../models/Application");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const validateRequest = require("../middleware/validateRequest");
const { feedbackCreateSchema, feedbackUpdateSchema } = require("../validators/feedback.schema");

router.get("/public", async (req, res, next) => {
  try {
    const data = await Feedback.find({ isPublic: true, status: { $in: ["responded", "resolved"] } })
      .populate("submittedBy", "displayName")
      .sort({ isFeatured: -1, createdAt: -1 })
      .limit(50);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get("/my", protect, async (req, res, next) => {
  try {
    const data = await Feedback.find({ submittedBy: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post("/", protect, validateRequest(feedbackCreateSchema), async (req, res, next) => {
  try {
    const payload = { ...req.body, submittedBy: req.user._id };

    // A post-adoption review: only the adopter of a completed adoption, once.
    if (payload.application) {
      const application = await Application.findOne({ _id: payload.application, applicant: req.user._id });
      if (!application) return res.status(404).json({ success: false, message: "Application not found" });
      if (application.type !== "adoption" || application.stage !== "completed") {
        return res.status(409).json({ success: false, message: "You can review an adoption once it is completed" });
      }
      if (await Feedback.exists({ application: application._id, submittedBy: req.user._id })) {
        return res.status(409).json({ success: false, message: "You have already reviewed this adoption" });
      }
      payload.type = "review";
      payload.relatedPet = application.pet;
    }

    const feedback = await Feedback.create(payload);
    res.status(201).json({ success: true, data: feedback });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ success: false, message: "You have already reviewed this adoption" });
    next(err);
  }
});

router.get("/", protect, adminOnly, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    const data = await Feedback.find(filter).populate("submittedBy", "displayName email").sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const feedback = await Feedback.findById(req.params.id).populate("submittedBy", "displayName email");
    if (!feedback) return res.status(404).json({ success: false, message: "Feedback not found" });
    res.json({ success: true, data: feedback });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", protect, adminOnly, validateRequest(feedbackUpdateSchema), async (req, res, next) => {
  try {
    const feedback = await Feedback.findById(req.params.id);
    if (!feedback) return res.status(404).json({ success: false, message: "Feedback not found" });

    Object.assign(feedback, req.body);
    if (req.body.adminResponse) {
      feedback.respondedBy = req.user._id;
      feedback.respondedAt = new Date();
      if (feedback.status === "new" || feedback.status === "in_review") feedback.status = "responded";
    }
    await feedback.save();

    res.json({ success: true, data: feedback });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const feedback = await Feedback.findByIdAndDelete(req.params.id);
    if (!feedback) return res.status(404).json({ success: false, message: "Feedback not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
