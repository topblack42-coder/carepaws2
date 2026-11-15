# CarePaws Merge Verification

This archive is the merged CarePaws source assembled from the three supplied versions plus the previously merged candidate.

## Merge decisions

- Version B / the previously merged candidate is the primary base because it contained the strongest functional-fix set.
- Version C's Babybook ownership/CRUD tests and Babybook-related UI changes were retained where they improved the merged implementation.
- The stronger merged application controller was preserved rather than replacing it with Version C's older controller.
- The stronger Babybook route was preserved, including pet-ownership authorization and Mongoose update validation.
- A unique partial MongoDB index prevents more than one pending/approved application from controlling a pet at once.

## Additional repairs in this final pass

- Prevented an approved application from being reopened to `pending` or changed to `rejected`.
- Prevented Babybook entry updates from changing the entry's `pet` relationship.
- Babybook pet access now verifies that the target pet exists before returning an empty result to staff.
- Added regression coverage for approved-application reopening and Babybook pet reassignment.

## Verification performed in the build environment

- All backend JavaScript source and test files passed `node --check` syntax validation.
- Adoption and Babybook integration tests from the supplied fixes were present and retained.
- Frontend/backend route wiring for `/api/applications` and `/api/baby-book` was inspected against the mounted Express routes.

## Runtime limitation

A full Jest/Expo/Vite runtime test could not be executed in this environment because dependency installation could not complete before the execution limit and the environment did not have the required frontend/backend dependency trees preinstalled. No runtime success is claimed solely from static checks.

## Email verification (resend, enforcement, link targets)

- `POST /api/auth/resend-verification` (authenticated) re-issues the token through the same helper `register` uses (`src/utils/emailVerification.js`). Only token hashes are stored; raw tokens appear only in the email.
- `requireVerifiedEmail` (after `protect`) gates adoption/foster applications, shift enrolment and volunteer sign-up for member accounts. Staff, admin and super_admin accounts are exempt because they are provisioned by the shelter and create records on applicants' behalf from the admin app. Admin-created accounts are therefore not force-marked verified; the exemption is by role.
- Verification links are mobile deep links by default. Setting `WEB_APP_URL` adds a `webVerifyUrl` template variable that lands on the admin build's public `/verify-email` page. Without it, links are mobile-only and that page is only reachable by someone who has the token.
- Registration keeps the account if the email fails and returns `emailSent: false` (alongside `emailSkipped`).
- One-off backfill for pre-existing unverified accounts: `lykasServer/scripts/backfill-email-verification.js` (see SETUP.md). It is never run automatically.

### Not verified in the build environment

The server integration tests could not run here (mongodb-memory-server needs to download a MongoDB binary, which was blocked). Server changes were syntax-checked and linted only; run `npm test` in `lykasServer`. The per-IP resend limiter is Redis-backed and mocked in tests like the other limiters.
