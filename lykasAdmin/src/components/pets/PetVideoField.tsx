import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Film, Trash2, Upload, X } from "lucide-react";
import Button from "../ui/Button";
import type { PetVideo } from "../../hooks/usePets";

// Keep these in sync with the server's PET_VIDEO_MAX_SIZE_MB /
// PET_VIDEO_MAX_DURATION_SECONDS. The server is the authority — these
// only give admins instant feedback before a slow upload.
const PET_VIDEO_MAX_MB = Number(import.meta.env.VITE_PET_VIDEO_MAX_MB) || 25;
const PET_VIDEO_MAX_SECONDS = Number(import.meta.env.VITE_PET_VIDEO_MAX_SECONDS) || 60;

interface PetVideoFieldProps {
  idPrefix: string;
  /** The validated file the admin has chosen but not yet saved. */
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** The video currently saved on the pet, if any. */
  existingVideo?: PetVideo | null;
  /** When provided, an existing video can be removed (explicit API call). */
  onRemoveExisting?: () => void | Promise<unknown>;
  removing?: boolean;
  uploading?: boolean;
  disabled?: boolean;
}

function formatDuration(seconds?: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isMp4(file: File) {
  return file.type === "video/mp4" || (!file.type && /\.mp4$/i.test(file.name));
}

export default function PetVideoField({
  idPrefix,
  file,
  onFileChange,
  existingVideo,
  onRemoveExisting,
  removing,
  uploading,
  disabled,
}: PetVideoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = useState<{ file: File; url: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Object URL for the accepted file's preview, revoked when it changes.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Release a pending validation URL if the component goes away mid-check.
  useEffect(() => {
    return () => {
      if (candidate) URL.revokeObjectURL(candidate.url);
    };
  }, [candidate]);

  const dropCandidate = useCallback(() => setCandidate(null), []);

  function handlePicked(picked: File | null | undefined) {
    if (!picked) return;
    setError(null);
    setConfirmingRemove(false);

    if (!isMp4(picked)) {
      setError("Unsupported format. Please choose an MP4 video (H.264).");
      return;
    }
    if (picked.size > PET_VIDEO_MAX_MB * 1024 * 1024) {
      setError(`This video is ${formatMb(picked.size)}. The maximum is ${PET_VIDEO_MAX_MB} MB.`);
      return;
    }
    // Duration/codec are checked by loading the file's metadata (below).
    setCandidate({ file: picked, url: URL.createObjectURL(picked) });
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    handlePicked(e.target.files?.[0]);
    e.target.value = ""; // allow choosing the same file again
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (disabled) return;
    handlePicked(e.dataTransfer.files?.[0]);
  }

  function onCandidateMetadata(duration: number) {
    if (!candidate) return;
    if (Number.isFinite(duration) && duration > PET_VIDEO_MAX_SECONDS + 0.5) {
      setError(`This video is ${Math.round(duration)} seconds long. The maximum is ${PET_VIDEO_MAX_SECONDS} seconds.`);
    } else {
      onFileChange(candidate.file);
    }
    dropCandidate();
  }

  function onCandidateError() {
    setError("This video can't be previewed. It may be corrupted or use an unsupported codec — please choose another file (MP4 with H.264).");
    dropCandidate();
  }

  async function confirmRemove() {
    if (removing) return;
    try {
      await onRemoveExisting?.();
    } catch {
      // The parent reports the failure; keep the confirm prompt open so the
      // admin can retry instead of seeing an unhandled rejection.
      return;
    }
    setConfirmingRemove(false);
  }

  const hasSavedVideo = !!existingVideo;
  const replacing = !!file && hasSavedVideo;

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-[#FDFAF4] p-4" data-testid={`${idPrefix}-video-field`}>
      <div className="mb-1 flex items-center gap-2">
        <Film className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-gray-800">Pet Introduction Video (Optional)</h3>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">Optional</span>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Upload a short video to help potential adopters get to know this pet. Show their personality, behavior, playfulness, or interactions with people. This is
        optional.
      </p>

      {/* Hidden metadata check for the file the admin just picked. */}
      {candidate && (
        <video
          data-testid={`${idPrefix}-video-validator`}
          src={candidate.url}
          preload="metadata"
          muted
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          onLoadedMetadata={(e) => onCandidateMetadata(e.currentTarget.duration)}
          onError={onCandidateError}
        />
      )}

      {candidate && <p className="mb-2 text-xs text-gray-500">Checking video…</p>}

      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-status-danger/20 bg-status-dangerBg px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      )}

      {/* New, validated selection: preview + cancel. */}
      {file && previewUrl && (
        <div className="mb-3">
          <video
            data-testid={`${idPrefix}-video-preview`}
            src={previewUrl}
            controls
            preload="metadata"
            className="aspect-video w-full rounded-xl bg-black"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-gray-600">
              {file.name} · {formatMb(file.size)}
              {replacing ? " — replaces the current video when you save" : " — uploads when you save"}
            </p>
            <Button type="button" variant="ghost" onClick={() => onFileChange(null)} disabled={disabled} className="shrink-0 !px-2 !py-1">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              {replacing ? "Keep current video" : "Remove selection"}
            </Button>
          </div>
          {uploading && <p className="mt-1 text-xs text-gray-500">Uploading video — this can take a moment on slower connections…</p>}
        </div>
      )}

      {/* Saved video (hidden while a replacement is staged). */}
      {hasSavedVideo && !file && existingVideo && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-medium text-gray-700">
            Current video{formatDuration(existingVideo.duration) ? ` · ${formatDuration(existingVideo.duration)}` : ""}
          </p>
          <video
            data-testid={`${idPrefix}-video-current`}
            src={existingVideo.url}
            poster={existingVideo.thumbnailUrl ?? undefined}
            controls
            preload="none"
            className="aspect-video w-full rounded-xl bg-black"
          />
          {confirmingRemove ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-status-dangerBg px-3 py-2">
              <p className="text-xs text-gray-700">Remove this video? The pet and its photos stay as they are.</p>
              <Button type="button" variant="danger" onClick={confirmRemove} loading={removing} className="!px-3 !py-1">
                Yes, remove video
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirmingRemove(false)} disabled={removing} className="!px-3 !py-1">
                Keep it
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={disabled} className="!px-3 !py-1">
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Replace video
              </Button>
              {onRemoveExisting && (
                <Button type="button" variant="ghost" onClick={() => setConfirmingRemove(true)} disabled={disabled} className="!px-3 !py-1 text-status-danger">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Remove video
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Picker: shown whenever there's nothing staged and nothing saved. */}
      {!file && !hasSavedVideo && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-white px-4 py-5 text-center"
        >
          <Upload className="h-5 w-5 text-gray-400" aria-hidden="true" />
          <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={disabled}>
            Choose a video
          </Button>
          <p className="text-xs text-gray-500">or drag and drop it here</p>
        </div>
      )}

      <input
        ref={inputRef}
        id={`${idPrefix}-video`}
        type="file"
        accept="video/mp4"
        aria-label="Pet introduction video file"
        onChange={handleInputChange}
        disabled={disabled}
        className="hidden"
      />

      <p className="mt-2 text-[11px] text-gray-400">
        MP4 (H.264) · up to {PET_VIDEO_MAX_MB} MB · up to {PET_VIDEO_MAX_SECONDS} seconds
      </p>
    </div>
  );
}
