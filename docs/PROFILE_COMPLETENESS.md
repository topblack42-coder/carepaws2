# Profile completeness: important info in Settings

Shelter staff need an applicant's phone number and home address to review an
adoption or foster application. This change makes sure that info lives in
**Settings**, shows staff **which account is applying**, and **recommends
users fill in missing info**.

## What changed

### Mobile app (`lykasUser`)

| File | Change |
|---|---|
| `utils/profileCompleteness.ts` (new) | `getMissingProfileFields(user)` returns which of phone / address are empty. |
| `app/(tabs)/settings.tsx` | Shows a **"Complete your profile"** card when phone or address is missing. Contact details now say they are shared with the shelter. |
| `app/pets/apply/[id].tsx` | Phone and address are **prefilled from the profile**. If the profile is missing them, a banner recommends filling them in with a **Go to Settings** button. |
| `__tests__/application-form.test.tsx` | Mocks `useAuth`; 2 new tests (banner shown, prefill works). |

### Admin panel (`lykasAdmin`)

| File | Change |
|---|---|
| `src/pages/ApplicationDetails.tsx` | Yellow **"Missing information"** alert listing empty phone, address, household size or pet experience. New **Applicant account** section: account name, email verified, identity verification, and the phone and address saved on the account. |
| `tests/pages/ApplicationDetails.test.tsx` | 4 new tests. |

## Server change needed (`lykasServer` was not in the zip)

The admin **Applicant account** section appears only when the API returns the
account's verification fields. Where the applicant is populated (likely
`applicationController.js`, `getApplicationById`), include them:

```js
.populate("applicant", "displayName email phone address emailVerified identityVerificationStatus")
```

Until then the section stays hidden. The "Missing information" alert works
now, because it uses data already on the application.

## Behavior notes

- Household size, experience and renting stay **per application** (they are
  not on the `User` model), so they remain on the apply form, not in Settings.
  To store them in Settings too, add them to the `User` schema and to
  `PUT /api/auth/profile`.
- The server omits empty fields, so the admin cannot tell "no phone" from "not
  sent". It treats account details as known only when `emailVerified` or
  `identityVerificationStatus` is present.

## Testing

Run on the changed files:

- `lykasAdmin`: `npx tsc -b` passes; `ApplicationDetails.test.tsx` 17/17 pass.
- `lykasUser`: `npx tsc --noEmit` passes; `application-form.test.tsx` 13/13 pass.
- Not run on a device or emulator, so the Settings banner and apply banner are
  untested visually.
- Failures that were already there before this change and are unrelated:
  `auth-screens.test.tsx` (3 SignUp tests) and `PetFields.test.tsx` (2 tests).

To try it: sign in with an account that has no phone or address, open
Settings (banner appears), then open any pet's apply form (banner with **Go to
Settings**). Save contact details and reopen the form: fields are prefilled.
