const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Feedback = require("../models/Feedback");
const Application = require("../models/Application");
const { notifyOnce } = require("../utils/notificationHelper");
const logger = require("../utils/logger");
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

// "Jane Doe" -> "Jane D." — reviews are public, so never expose full names.
function publicName(displayName) {
  const parts = String(displayName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CarePaws adopter";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

// Community reviews for the mobile app: published reviews, a rating summary,
// and the caller's own general review (so the app can show "pending approval").
// Optional ?pet=<id> narrows to one pet, ?limit= caps the list (max 50).
router.get("/reviews", protect, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const filter = { type: "review", isPublic: true, status: { $ne: "archived" } };
    if (req.query.pet) {
      if (!mongoose.isValidObjectId(req.query.pet)) return res.status(400).json({ success: false, message: "Invalid pet id" });
      filter.relatedPet = new mongoose.Types.ObjectId(String(req.query.pet));
    }

    const [docs, grouped, mine] = await Promise.all([
      Feedback.find(filter)
        .populate("submittedBy", "displayName")
        .populate("relatedPet", "name")
        .sort({ isFeatured: -1, createdAt: -1 })
        .limit(limit)
        .lean(),
      Feedback.aggregate([{ $match: { ...filter, rating: { $gte: 1 } } }, { $group: { _id: "$rating", count: { $sum: 1 } } }]),
      Feedback.findOne({ submittedBy: req.user._id, type: "review", application: { $exists: false } })
        .select("rating status isPublic createdAt")
        .lean(),
    ]);

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let sum = 0;
    for (const g of grouped) {
      distribution[g._id] = g.count;
      total += g.count;
      sum += g._id * g.count;
    }

    const reviews = docs.map((d) => ({
      _id: d._id,
      rating: d.rating ?? null,
      subject: d.subject || "",
      message: d.message,
      createdAt: d.createdAt,
      isFeatured: !!d.isFeatured,
      adminResponse: d.adminResponse || "",
      reviewer: { name: publicName(d.submittedBy?.displayName) },
      pet: d.relatedPet ? { _id: d.relatedPet._id, name: d.relatedPet.name } : null,
      isMine: String(d.submittedBy?._id) === String(req.user._id),
    }));

    res.json({
      success: true,
      data: {
        reviews,
        summary: { average: total ? Math.round((sum / total) * 10) / 10 : 0, count: total, distribution },
        mine: mine ? { _id: mine._id, rating: mine.rating, status: mine.status, isPublic: !!mine.isPublic } : null,
      },
    });
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

    // A standalone review (not tied to an adoption): a rating is required and
    // each user can leave one. It stays unpublished until staff approve it.
    if (payload.type === "review" && !payload.application) {
      if (!payload.rating) return res.status(400).json({ success: false, message: "Please choose a star rating" });
      if (await Feedback.exists({ submittedBy: req.user._id, type: "review", application: { $exists: false } })) {
        return res.status(409).json({ success: false, message: "You have already shared a review. Thank you!" });
      }
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

    const wasPublic = feedback.isPublic;
    Object.assign(feedback, req.body);
    if (req.body.adminResponse) {
      feedback.respondedBy = req.user._id;
      feedback.respondedAt = new Date();
      if (feedback.status === "new" || feedback.status === "in_review") feedback.status = "responded";
    }
    await feedback.save();

    // Tell the reviewer when their review goes live (best effort).
    if (feedback.type === "review" && feedback.isPublic && !wasPublic && feedback.submittedBy) {
      try {
        await notifyOnce({
          recipient: feedback.submittedBy,
          sender: req.user._id,
          type: "GENERAL",
          title: "Your review is live",
          message: "Thanks for sharing your experience — other adopters can now read your review.",
          dedupeKey: `review-live:${feedback._id}`,
        });
      } catch (err) {
        logger.error({ err, feedbackId: feedback._id }, "Failed to notify reviewer");
      }
    }

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
