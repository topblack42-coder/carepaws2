# CarePaws: Housing details in Settings

Phone, address and renting now live in **Settings**. Renters can upload a photo of their landlord's approval for pets. Application forms reuse these saved details.

## How it works

1. User opens **Settings** and saves phone and address (existing "Save contact details" button).
2. In the new **Housing** card they turn on "I am renting my home" and upload a photo of the landlord's approval. Both save immediately.
3. On the **apply screen** they see a read-only "Your details" card with an **Edit in Settings** link.
4. A renter with no photo cannot submit and is told to add one in Settings.
5. The server copies the photo URL from the user's profile onto the application.
6. In the **admin app**, the application details page shows the photo. Clicking it opens the full image.

## Files changed

### Server (`lykasServer/src`)
| File | Change |
|---|---|
| `models/User.js` | Added `isRenting` and `landlordProofUrl` |
| `models/Application.js` | Added `landlordProofUrl` (copy taken at apply time) |
| `controllers/authController.js` | `publicUser` returns the new fields. `updateProfile` accepts `isRenting`, and clears the photo when `isRenting` is `false` |
| `controllers/applicationController.js` | `createApplication` copies the photo from the applicant's profile (never from the request body) |
| `routes/authRoutes.js` | New `POST /api/auth/landlord-proof` (upload) and `DELETE /api/auth/landlord-proof` (remove) |
| `validators/auth.schema.js` | `updateProfileSchema` accepts `isRenting` |

### Mobile (`lykasUser`)
| File | Change |
|---|---|
| `app/(tabs)/settings.tsx` | New Housing card: renting switch, upload, replace, remove |
| `app/pets/apply/[id].tsx` | Removed phone, address and renting inputs. Added read-only summary. Added renter photo check |
| `context/AuthContext.tsx` | `AppUser` gains `isRenting` and `landlordProofUrl` |

### Admin (`lykasAdmin`)
| File | Change |
|---|---|
| `src/pages/ApplicationDetails.tsx` | Shows the landlord approval photo for renters |

### Tests
- `lykasUser/__tests__/application-form.test.tsx` (updated)
- `lykasUser/__tests__/settings-housing.test.tsx` (new)
- `lykasAdmin/tests/pages/ApplicationDetails.test.tsx` (2 tests added)

## API

| Method | Path | Body | Result |
|---|---|---|---|
| `PUT` | `/api/auth/profile` | `{ "isRenting": true }` | Updated user. `false` also clears the photo |
| `POST` | `/api/auth/landlord-proof` | multipart, field `image` (jpeg, png, webp) | `{ isRenting: true, landlordProofUrl }` |
| `DELETE` | `/api/auth/landlord-proof` | none | `{ landlordProofUrl: null }` |

`POST /api/applications` still takes `isRenting` and `landlordApproval`. `landlordApproval` is now sent as `true` only when a photo is on file. `landlordProofUrl` is **not** accepted in the body (the schema is strict).

## Test status

| Area | Status |
|---|---|
| Mobile tests for changed screens | Run, passing (25 tests) |
| Mobile `tsc` | Run, clean |
| Mobile full suite | 3 failures in `auth-screens.test.tsx`; these also fail on the original zip |
| Admin `tsc` and `ApplicationDetails` tests | Run, passing (19 tests) |
| Admin full suite | 2 failures in `PetFields.test.tsx`; these also fail on the original zip |
| Server validators, profile update, application copy | Checked with stubs (no database), passing |
| Server integration tests | **Not run.** They need a MongoDB binary the sandbox could not download |
| Upload and remove routes | **Not tested.** They follow the existing profile-picture route, so run one real upload |
| On a physical phone | **Not tested** |

## Notes

- Photos upload to Cloudinary as regular public links, like your other uploads. Leases and letters can hold personal info, so consider private access later.
- The separate "landlord approved" switch was removed. The photo is the proof.
- To make the photo optional for renters, remove the `isRenting && !landlordProofUrl` check in `handleSubmit` in `app/pets/apply/[id].tsx`.

## Try it

1. Run the server, then `npx expo start` in `lykasUser`.
2. Settings: turn on renting and upload a photo.
3. Apply to a pet. Confirm the details card shows your phone, address and "Renting · landlord approval photo added".
4. Open the application in the admin app and confirm the photo shows.
5. Turn renting off in Settings. Confirm the photo is gone.
