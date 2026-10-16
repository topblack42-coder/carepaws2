const cloudinary = require("../config/cloudinary");
const Pet = require("../models/Pet");
const logger = require("./logger");
const { getVideoLimits } = require("../config/petVideo");

const VIDEO_FOLDER = "carepaws/pet-videos";
const UPLOAD_TIMEOUT_MS = 120000;

// ISO base-media "ftyp" brands that identify a regular MP4 container.
// QuickTime ("qt  "), HEIF/AVIF brands etc. are deliberately absent.
const MP4_BRANDS = new Set([
  "isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9",
  "mp41", "mp42", "avc1", "dash", "msdh", "mmp4", "M4V ", "M4VH", "M4VP", "MSNV", "f4v ",
]);

/** An error that is safe to show to the admin and carries its HTTP status. */
class VideoUploadError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "VideoUploadError";
    this.statusCode = statusCode;
  }
}

/**
 * Identifies the real container from the file's leading bytes rather than
 * trusting the filename or the browser-supplied MIME type.
 * Returns "video/mp4" or null.
 */
function sniffVideoMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.toString("latin1", 4, 8) === "ftyp" && MP4_BRANDS.has(buffer.toString("latin1", 8, 12))) {
    return "video/mp4";
  }
  return null;
}

/** First-frame JPEG thumbnail derived from the Cloudinary delivery URL. */
function buildThumbnailUrl(secureUrl) {
  if (typeof secureUrl !== "string" || !secureUrl.includes("/video/upload/")) return null;
  return secureUrl
    .replace("/video/upload/", "/video/upload/so_0,w_800,c_limit,q_auto,f_jpg/")
    .replace(/\.[a-z0-9]+$/i, ".jpg");
}

function uploadStream(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "video",
        folder: VIDEO_FOLDER,
        use_filename: false,
        unique_filename: true,
        overwrite: false,
        timeout: UPLOAD_TIMEOUT_MS,
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

/** Best-effort removal of a Cloudinary video asset. Never throws. */
async function destroyVideo(publicId) {
  if (!publicId) return false;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "video", invalidate: true });
    return true;
  } catch (err) {
    logger.warn({ err, publicId }, "Failed to delete pet video asset from Cloudinary");
    return false;
  }
}

/**
 * Deletes a video asset once nothing references it any more. Call this
 * AFTER the pet document has been saved without the video, so a failed
 * database update can never leave a pet pointing at a deleted file.
 */
async function releaseVideoAsset(video) {
  const publicId = video && video.publicId;
  if (!publicId) return false;
  try {
    const stillReferenced = await Pet.countDocuments({ "video.publicId": publicId });
    if (stillReferenced > 0) return false;
  } catch (err) {
    // If we can't prove it's unreferenced, keep the file rather than risk a broken video.
    logger.warn({ err, publicId }, "Could not verify pet video references; leaving asset in place");
    return false;
  }
  return destroyVideo(publicId);
}

/**
 * Validates and uploads a multer memory-storage file. Resolves with the
 * object to store in `pet.video`, or throws VideoUploadError.
 */
async function uploadPetVideo(file) {
  const limits = getVideoLimits();

  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new VideoUploadError(400, "The uploaded video file is empty.");
  }
  if (file.buffer.length > limits.maxSizeBytes) {
    throw new VideoUploadError(413, `Video must be ${limits.maxSizeMb} MB or smaller.`);
  }
  const sniffed = sniffVideoMimeType(file.buffer);
  if (!sniffed) {
    throw new VideoUploadError(415, "The file is not a valid MP4 video. Please upload an MP4 (H.264) file.");
  }

  let result;
  try {
    result = await uploadStream(file.buffer);
  } catch (err) {
    logger.error({ err }, "Pet video upload to Cloudinary failed");
    const code = err && err.http_code;
    if (code === 400) {
      throw new VideoUploadError(422, "The video could not be processed. It may be corrupted or use an unsupported codec.");
    }
    if (code === 499 || (err && err.name === "TimeoutError")) {
      throw new VideoUploadError(504, "The video upload timed out. Please try again on a faster connection.");
    }
    throw new VideoUploadError(502, "Video storage is temporarily unavailable. Please try again.");
  }

  const reject = async (status, message) => {
    await destroyVideo(result && result.public_id);
    throw new VideoUploadError(status, message);
  };

  const hasVideoStream = result.is_audio !== true && Boolean(result.video || result.width);
  if (!hasVideoStream) {
    await reject(422, "The file does not contain a video track.");
  }

  const codec = result.video && result.video.codec;
  if (codec && !/^(h264|avc)/i.test(String(codec))) {
    await reject(422, `Unsupported video codec "${codec}". Please re-export the video as MP4 with H.264 encoding.`);
  }

  // Duration is read by Cloudinary's media analysis, so no ffmpeg is needed here.
  if (typeof result.duration === "number" && result.duration > limits.maxDurationSeconds + 0.5) {
    await reject(422, `Video must be ${limits.maxDurationSeconds} seconds or shorter.`);
  }

  return {
    url: result.secure_url,
    thumbnailUrl: buildThumbnailUrl(result.secure_url),
    publicId: result.public_id,
    duration: typeof result.duration === "number" ? result.duration : null,
    mimeType: sniffed,
    size: typeof result.bytes === "number" ? result.bytes : file.buffer.length,
    width: result.width ?? null,
    height: result.height ?? null,
    uploadedAt: new Date(),
  };
}

module.exports = {
  VideoUploadError,
  sniffVideoMimeType,
  buildThumbnailUrl,
  uploadPetVideo,
  destroyVideo,
  releaseVideoAsset,
};
