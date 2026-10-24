const cloudinary = require("../config/cloudinary");
const UserDocument = require("../models/UserDocument");
const Application = require("../models/Application");
const User = require("../models/User");

function uploadBufferToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: "auto" }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

async function myDocuments(req, res, next) {
  try {
    const data = await UserDocument.find({ user: req.user._id }).sort({ createdAt: -1 });
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// Resolves which application (if any) a newly uploaded document should be
// linked to. The mobile "Documents" screen — the only upload flow today —
// is opened generically from the profile tab, not from inside a specific
// application, so it never sends an `application` id itself; left alone,
// that means every document it creates is orphaned from the case it's
// actually for (a proof-of-income upload during a pending adoption has no
// record of which adoption it belongs to). Where a caller does supply an
// id, it's trusted only after confirming it actually belongs to this
// applicant — never taken as-is. Where none is supplied, it's inferred
// only when unambiguous: exactly one application still in progress for
// this applicant. With zero or several open applications there's no safe
// way to guess which one is meant, so the document is left unlinked, same
// as it always has been.
async function resolveApplicationId(req) {
  if (req.body.application) {
    const application = await Application.findOne({
      _id: req.body.application,
      applicant: req.user._id,
    }).select("_id status");
    if (!application) {
      const error = new Error("Application not found");
      error.statusCode = 404;
      throw error;
    }
    if (application.status !== "pending") {
      const error = new Error("Documents can only be uploaded while an application is in progress");
      error.statusCode = 409;
      throw error;
    }
    return application._id;
  }

  const openApplications = await Application.find({ applicant: req.user._id, status: "pending" })
    .select("_id")
    .limit(2);
  return openApplications.length === 1 ? openApplications[0]._id : null;
}

async function upload(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const applicationId = await resolveApplicationId(req);
    const result = await uploadBufferToCloudinary(req.file.buffer, "carepaws/documents");

    const doc = await UserDocument.create({
      user: req.user._id,
      application: applicationId,
      type: req.body.type,
      label: req.body.label,
      fileUrl: result.secure_url,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
    });

    // A government ID upload puts the user in the staff review queue.
    // Already-verified users are left alone.
    if (doc.type === "government_id") {
      await User.updateOne(
        { _id: req.user._id, identityVerificationStatus: { $in: ["unverified", "rejected"] } },
        { identityVerificationStatus: "pending" }
      );
    }

    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const doc = await UserDocument.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.application) filter.application = req.query.application;
    const data = await UserDocument.find(filter)
      .populate("user", "displayName email")
      .populate({
        path: "application",
        select: "pet applicant status stage type",
        populate: { path: "pet", select: "name" },
      })
      .sort({ createdAt: -1 });
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function verify(req, res, next) {
  try {
    const doc = await UserDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });

    doc.status = req.body.status;
    doc.verifiedBy = req.user._id;
    doc.verifiedAt = new Date();
    // Only overwrite the reason when the request actually carries one (or
    // is explicitly clearing it); a status-only PUT — e.g. re-approving —
    // shouldn't wipe out a reason that was set moments ago by a separate
    // call.
    if (Object.prototype.hasOwnProperty.call(req.body, "rejectedReason")) {
      doc.rejectedReason = req.body.rejectedReason;
    } else if (doc.status !== "rejected") {
      doc.rejectedReason = undefined;
    }
    await doc.save();

    // Keep the user's identity status in sync with their government ID review.
    if (doc.type === "government_id" && (doc.status === "verified" || doc.status === "rejected")) {
      await User.updateOne(
        { _id: doc.user },
        {
          identityVerificationStatus: doc.status,
          identityVerifiedBy: req.user._id,
          identityVerifiedAt: new Date(),
          identityVerificationNotes: doc.status === "rejected" ? doc.rejectedReason || null : null,
        }
      );
    }

    return res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
}

module.exports = { myDocuments, upload, remove, list, verify };
