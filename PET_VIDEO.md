# Optional pet introduction video

Every pet profile can have one optional short MP4 video. Pets without a video behave exactly as before.

## Behaviour

| Who | What |
|---|---|
| Admin (create) | Add a video or skip it. The form never requires one. |
| Admin (edit) | Add a video later, replace it, or remove it. Editing other fields never touches the video. |
| Adopter (mobile) | Pet details shows a "Meet <name>" section **only** when a video exists. Tap to play; nothing is downloaded or auto-played on page open. |

## Limits (configurable)

| Setting | Default | Where |
|---|---|---|
| `PET_VIDEO_MAX_SIZE_MB` | 25 | server `.env` (authoritative) |
| `PET_VIDEO_MAX_DURATION_SECONDS` | 60 | server `.env` (authoritative) |
| `VITE_PET_VIDEO_MAX_MB` / `VITE_PET_VIDEO_MAX_SECONDS` | 25 / 60 | admin `.env` (instant client-side feedback only) |

Format: **MP4 with H.264**. WebM is deliberately not accepted: expo-video on iOS plays through AVPlayer, which can't reliably decode it.

## API (extends the existing pet routes)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/pets` | staff/admin/super_admin | Existing multipart create; now also accepts optional `video` file. |
| `PUT /api/pets/:id` | staff/admin/super_admin | Existing multipart update; a `video` file adds/replaces. **Omitting `video` keeps the current one.** |
| `DELETE /api/pets/:id/video` | staff/admin/super_admin | Explicit removal. Idempotent. Pet, photo and other data untouched. |
| `GET /api/pets`, `GET /api/pets/:id` | public | Responses now include `video` (object, or `null`). |

`video` shape: `{ url, thumbnailUrl, publicId, duration, mimeType, size, width, height, uploadedAt }`.

Error statuses (JSON `{ success: false, message }`): `400` bad id / unexpected field, `401/403` auth, `404` pet not found, `413` too large, `415` not a valid MP4, `422` too long / unsupported codec / unprocessable, `502` storage unavailable, `504` upload timed out.

## Storage and safety

* Binary stored in **Cloudinary** (the project's existing provider) under `carepaws/pet-videos`; MongoDB keeps only the URL + metadata (`Pet.video`, default `null`, no migration needed).
* The file is validated server-side by **magic bytes** (not filename/MIME), size, and — via Cloudinary's media analysis — **duration and codec**. A rejected upload is deleted from Cloudinary.
* The pet record is updated only after the upload succeeds. The previous file is deleted **after** the new reference is saved, and only if no other pet references it. A failed save deletes the new upload instead.
* Videos are delivered as public HTTPS URLs (adoption listings are public). Credentials stay on the server.

## Hosting notes

* Uploads are buffered in memory by multer (as image uploads already were), so a 25 MB video uses ~25 MB RAM per concurrent upload.
* Cloudinary's plan caps video upload size (check your plan; the free tier is lower than most paid ones). Keep `PET_VIDEO_MAX_SIZE_MB` below it.
* If a reverse proxy sits in front of the API, raise its body limit (e.g. nginx `client_max_body_size 30m`).

## Mobile (Expo)

Adds the `expo-video` dependency (`~55.0.21`). Run `npm install` in `lykasUser`. Expo Go includes it; **development/production builds must be rebuilt** to include the native module.

## Tests

```bash
cd lykasServer && npm test          # includes tests/integration/pet.video.test.js
cd lykasAdmin  && npm test          # includes tests/components/PetVideo.test.tsx
cd lykasUser   && npm test          # includes __tests__/pet-video.test.tsx
```

## Manual checklist (needs a real device / real Cloudinary account)

- [ ] Upload a real ~20 s phone MP4 from the admin form; confirm preview, save, and playback on Android and iOS.
- [ ] Replace it; confirm the old asset disappears from the Cloudinary media library.
- [ ] Remove it; confirm the pet page on mobile shows no video section.
- [ ] Try an HEVC (.mp4) clip and a >60 s clip; confirm clear errors.
- [ ] Play on a throttled connection; confirm loading/error/retry states.
