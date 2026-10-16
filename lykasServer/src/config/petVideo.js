/**
 * Limits for the optional pet introduction video. Read lazily from the
 * environment so they can be tuned per deployment without a code change.
 *
 * Only MP4 (H.264) is accepted. WebM is intentionally excluded: expo-video
 * on iOS plays through AVPlayer, which can't reliably decode WebM, so
 * accepting it would let an admin upload a video that adopters on iPhones
 * can't watch.
 */
const DEFAULT_MAX_SIZE_MB = 25;
const DEFAULT_MAX_DURATION_SECONDS = 60;

const VIDEO_MIME_TYPES = ["video/mp4"];

function positiveNumber(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getVideoLimits() {
  const maxSizeMb = positiveNumber(process.env.PET_VIDEO_MAX_SIZE_MB, DEFAULT_MAX_SIZE_MB);
  const maxDurationSeconds = positiveNumber(process.env.PET_VIDEO_MAX_DURATION_SECONDS, DEFAULT_MAX_DURATION_SECONDS);
  return {
    maxSizeMb,
    maxSizeBytes: Math.round(maxSizeMb * 1024 * 1024),
    maxDurationSeconds,
    allowedMimeTypes: VIDEO_MIME_TYPES,
  };
}

module.exports = { getVideoLimits, VIDEO_MIME_TYPES };
