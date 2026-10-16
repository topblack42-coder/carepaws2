const multer = require("multer");
const { getVideoLimits, VIDEO_MIME_TYPES } = require("../config/petVideo");

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DOCUMENT_TYPES = [...IMAGE_TYPES, "application/pdf"];

const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024;

/**
 * Builds a multer instance with memory storage (buffer streamed straight
 * to Cloudinary by the controller, never written to disk) plus a
 * MIME-type allowlist. The original source validated uploads by size
 * only — this fileFilter is the fix (§11.6.3): anything outside the
 * allowlist is rejected before the buffer is ever read.
 */
function makeUploader(allowedTypes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
      if (allowedTypes.includes(file.mimetype)) {
        return cb(null, true);
      }
      return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    },
  });
}

const uploadImage = makeUploader(IMAGE_TYPES);
const uploadDocument = makeUploader(DOCUMENT_TYPES);

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Pet create/update accept an optional `image` and an optional `video` in
 * one multipart request. Both are optional, so a request with neither is
 * still valid. Errors carry a statusCode so the central error handler
 * returns a useful 4xx instead of a generic 500:
 *   413 file too large, 415 unsupported type, 400 unexpected field.
 */
function makePetMediaUploader() {
  const { maxSizeBytes, maxSizeMb } = getVideoLimits();

  const parser = multer({
    storage: multer.memoryStorage(),
    // multer has a single size limit; per-field limits are enforced below.
    limits: { fileSize: Math.max(maxSizeBytes, MAX_FILE_SIZE), files: 2 },
    fileFilter: (req, file, cb) => {
      const allowed = file.fieldname === "video" ? VIDEO_MIME_TYPES : file.fieldname === "image" ? IMAGE_TYPES : null;
      if (!allowed) return cb(httpError(400, `Unexpected file field: ${file.fieldname}`));
      if (!allowed.includes(file.mimetype)) {
        return cb(httpError(415, `Unsupported ${file.fieldname} type: ${file.mimetype}. Allowed: ${allowed.join(", ")}`));
      }
      return cb(null, true);
    },
  }).fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]);

  return (req, res, next) => {
    parser(req, res, (err) => {
      if (err) {
        if (err.statusCode) return next(err);
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(
            httpError(413, err.field === "video" ? `Video must be ${maxSizeMb} MB or smaller.` : "Image is too large.")
          );
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
          return next(httpError(400, "Upload at most one image (field \"image\") and one video (field \"video\")."));
        }
        return next(err);
      }
      const video = req.files && req.files.video && req.files.video[0];
      const image = req.files && req.files.image && req.files.image[0];
      if (video && video.size > maxSizeBytes) return next(httpError(413, `Video must be ${maxSizeMb} MB or smaller.`));
      if (image && image.size > MAX_FILE_SIZE) return next(httpError(413, "Image is too large."));
      return next();
    });
  };
}

const uploadPetMedia = makePetMediaUploader();

module.exports = { uploadImage, uploadDocument, uploadPetMedia, IMAGE_TYPES, DOCUMENT_TYPES };
