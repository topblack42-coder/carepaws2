# CarePaws — Setup Guide

This walks you through getting all three repos (`lykasServer`, `lykasAdmin`,
`lykasUser`) running locally, from a clean machine to a working end-to-end
flow (register a user, log into the admin panel, create a pet, browse it in
the mobile app, submit an application).

Two paths are covered: **Docker Compose** (fastest, gets the backend + admin
panel running with one command) and **manual setup** (what Compose is doing
under the hood, useful if you need to debug something or you're setting up
the mobile app, which doesn't containerize).

---

## 0. What you'll need before starting

### Software
- **Node.js 22+** and npm
- **Docker Desktop** (or Docker Engine + Compose) — for the fast path
- **Git**
- For the mobile app: **Expo Go** app on your phone (easiest), or Xcode
  (iOS Simulator) / Android Studio (Android emulator) if you want a
  simulator instead of a physical device

### Accounts (free tiers work for all of these)
You can skip all of these at first — the app boots and most of it works
without them. They're only needed for the specific features listed:

| Service | Needed for | Get it at |
|---|---|---|
| MongoDB Atlas | The database, if not using the Dockerized local Mongo | mongodb.com/cloud/atlas |
| Cloudinary | Pet photos, document uploads | cloudinary.com |
| Google Cloud Console | Google Sign-In | console.cloud.google.com |
| PayMongo | Donations / adoption fee payments | paymongo.com |
| Any SMTP provider (or Gmail) | Verification/reset emails | — |

Without these configured, the app still runs: photo uploads and Google
sign-in just won't work, and emails silently no-op (logged, not sent)
rather than crashing anything.

---

## 1. Get the code

Extract the zip (or clone your repo, if you've pushed this to one) so you
have this layout:

```
carepaws/
├── README.md
├── docker-compose.yml
├── lykasServer/
├── lykasAdmin/
└── lykasUser/
```

---

## 2. Fast path — Docker Compose (backend + admin panel)

From the `carepaws/` root:

```bash
docker compose up
```

This builds and starts four containers:
- `mongo` (port 27017)
- `redis` (port 6379)
- `server` — the API, at **http://localhost:5000**
- `admin` — the staff console, at **http://localhost:5173**

First run will take a few minutes (installing dependencies inside the
containers). Once it settles, check the API is alive:

```bash
curl http://localhost:5000/health
# {"success":true,"status":"ok","db":"connected","uptime":...}
```

Open **http://localhost:5173** in a browser — you should see the admin
login screen. (You don't have an account yet — see §5.)

This compose stack uses placeholder secrets baked into
`docker-compose.yml` (`dev_only_jwt_secret_change_me_32chars`, etc.) —
fine for local dev, **never use these values anywhere real**.

**Skip to §5** to create your first admin account, or keep reading for
what Compose is doing under the hood / how to set up the mobile app.

---

## 3. Manual setup — `lykasServer`

If you're not using Compose (or want to run the backend outside a
container):

```bash
cd lykasServer
cp .env.example .env
```

Open `.env` and fill in at minimum:

```bash
MONGO_URI=mongodb://localhost:27017/carepaws        # or your Atlas connection string
REDIS_URL=redis://localhost:6379
JWT_SECRET=<any random 32+ character string>
JWT_REFRESH_SECRET=<a DIFFERENT random 32+ character string>
```

Generate random secrets quickly:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

You need a real Mongo and Redis instance for this to boot. Easiest way to
get both without installing them natively:

```bash
docker run -d -p 27017:27017 --name carepaws-mongo mongo:7
docker run -d -p 6379:6379 --name carepaws-redis redis:7-alpine
```

Then:

```bash
npm install
npm run dev
```

You should see:
```
CarePaws API listening on port 5000 (development)
```

Verify: `curl http://localhost:5000/health`

### Run the backend tests

```bash
npm test
```

This uses an in-memory MongoDB (`mongodb-memory-server`), so it doesn't
touch your real database. Note: the Redis-backed rate limiters are mocked
out in these tests — you don't need Redis running just to run `npm test`.

---

## 4. Manual setup — `lykasAdmin`

```bash
cd lykasAdmin
cp .env.example .env
```

Edit `.env`:
```bash
VITE_API_URL=http://localhost:5000
VITE_GOOGLE_CLIENT_ID=      # leave blank if you're not setting up Google Sign-In yet
```

```bash
npm install
npm run dev
```

Opens at **http://localhost:5173**.

---

## 5. Create your first admin account

This is the one manual step nothing automates for you: every account that
registers through the normal signup flow gets `role: "user"` by design —
there's no public "sign up as admin" path (that would be a security hole).
So your very first admin account has to be promoted by hand, once.

**Step 1 — Register a normal account.** Either:
- Through the admin login screen's flow isn't set up for self-registration
  (it's staff-only), so instead call the API directly:

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Admin User","email":"admin@example.com","password":"changeme123"}'
```

**Step 2 — Promote that account to `super_admin`.** Connect to Mongo and
update the user document directly:

```bash
# If using the Dockerized mongo:
docker exec -it $(docker ps -qf "name=mongo") mongosh carepaws

# If using a local mongosh install:
mongosh "mongodb://localhost:27017/carepaws"
```

Then in the mongo shell:
```js
db.users.updateOne(
  { email: "admin@example.com" },
  { $set: { role: "super_admin" } }
)
```

**Step 3 — Log in.** Go to http://localhost:5173, sign in with
`admin@example.com` / `changeme123`. You should land on the Dashboard.

> The `Role` collection (fine-grained permissions) starts empty — that's
> fine, because `super_admin` always short-circuits to "allowed" on every
> permission check (see `permissionMiddleware.js`). You only need to
> populate `Role` documents if you want to grant a `staff` or `admin`
> account permissions narrower than their role's defaults.

---

## 6. Manual setup — `lykasUser` (mobile app)

This one never containerizes — Expo builds natively.

```bash
cd lykasUser
cp .env.example .env
```

Edit `.env`:
```bash
EXPO_PUBLIC_API_URL=http://localhost:5000
```

**Important if you're testing on a physical phone**: `localhost` means
*the phone itself*, not your computer. Use your computer's LAN IP instead:

```bash
# macOS
ipconfig getifaddr en0
# Linux
hostname -I | awk '{print $1}'
# Windows (PowerShell)
ipconfig | findstr IPv4
```

Then set `EXPO_PUBLIC_API_URL=http://<that-ip>:5000` and make sure your
phone and computer are on the same Wi-Fi network. (A Simulator/Emulator
can usually still use `localhost`.)

```bash
npm install
npx expo start
```

Scan the QR code with the **Expo Go** app (Android) or your **Camera app**
(iOS, which hands off to Expo Go), or press `i`/`a` in the terminal to
launch a simulator.

You should land on the onboarding screens, then be able to sign up, browse
pets (empty until you add some via the admin panel — see §7), etc.

**One real limitation**: native Google Sign-In does *not* work inside Expo
Go — it needs a native build (a "dev client" via `eas build --profile
development`, or a full build). Everything else in the app works fine in
Expo Go.

---

## 7. Verify the end-to-end flow

With all three running, walk through this to confirm the whole stack talks
to itself correctly:

1. **Admin panel** → Manage Pets → Add pet. Fill in a name, species,
   upload a photo (needs Cloudinary configured — see §8 — otherwise skip
   the photo and it'll save with no image).
2. **Mobile app** → Adopt tab → pull to refresh. Your new pet should
   appear.
3. **Mobile app** → tap the pet → Apply to adopt → fill in the form,
   submit.
4. **Admin panel** → Adoption Applications → your new application should
   appear with status "pending", stage "submitted".
5. **Admin panel** → click the checkmark to approve it. The pet's status
   should flip to "Adopted" (check Manage Pets).
6. **Mobile app** → My Applications → the application should now show
   "approved".

If all six steps work, the full loop — auth, uploads (if configured), the
application pipeline, and the shared data model — is wired correctly
across all three repos.

---

## 8. Setting up external services (optional, but needed for full functionality)

### Cloudinary (pet photos, document uploads)
1. Sign up at cloudinary.com, free tier is plenty for dev.
2. From your Cloudinary dashboard, copy the **Cloud name**, **API Key**,
   and **API Secret**.
3. In `lykasServer/.env`:
   ```
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   ```
4. Restart the server. Photo uploads on both frontends will now work.

### Google Sign-In
This needs **three separate client IDs** (web, Android, iOS) — see the
inline comments in `lykasServer/.env.example` for why.

1. In Google Cloud Console, create a project (or use an existing one).
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
3. Create a **Web application** client ID — this is your
   `GOOGLE_CLIENT_ID` (backend) and `VITE_GOOGLE_CLIENT_ID` (admin panel).
4. Create an **Android** client ID — you'll need your app's package name
   (`com.kernharu.carepaws`, or whatever you rename it to) and a SHA-1
   signing certificate fingerprint. This is `ANDROID_CLIENT_ID` /
   `EXPO_PUBLIC_ANDROID_CLIENT_ID`.
5. Create an **iOS** client ID with your bundle identifier. This is
   `IOS_CLIENT_ID` / `EXPO_PUBLIC_IOS_CLIENT_ID`.
6. Fill all of these into the respective `.env` files, restart each app.

Remember: this only actually works end-to-end on the mobile side from a
native build, not Expo Go (see §6).

### PayMongo (payments)
1. Sign up at paymongo.com, grab your **test** secret key from the
   dashboard (starts with `sk_test_`).
2. In `lykasServer/.env`:
   ```
   PAYMONGO_SECRET_KEY=sk_test_xxxxxxxxxxxx
   ```
3. **Required, not optional** — set up a webhook endpoint in the
   PayMongo dashboard pointing at
   `https://<your-public-url>/api/payments/webhook`, and set
   `PAYMONGO_WEBHOOK_SECRET` to the signing secret it gives you. This
   isn't just extra signature verification: `webhook()` in
   `paymentController.js` rejects every event with a 500 when this is
   unset, and the webhook is the *only* place in the app that ever
   marks a payment `paid`. Skip this step and every donation, adoption
   fee, and event fee will charge the donor successfully through
   PayMongo and then sit as `pending` in CarePaws forever — nothing
   will ever correct it. (For local dev, PayMongo can't reach
   `localhost` — use a tool like `ngrok` to tunnel if you want to test
   the webhook path specifically. For the deployed demo, this must be
   set in Render's environment variables, not just locally.)

### Email (verification / password reset)
Two options — pick one, put it in `lykasServer/.env`:

**Gmail-style:**
```
EMAIL_SERVICE=gmail
EMAIL_USER=youraddress@gmail.com
EMAIL_PASSWORD=<an App Password, not your real Gmail password>
```
(Generate an App Password at myaccount.google.com/apppasswords — this
requires 2FA enabled on the Google account.)

**Generic SMTP (e.g. Mailtrap for testing):**
```
EMAIL_HOST=sandbox.smtp.mailtrap.io
EMAIL_PORT=2525
EMAIL_USERNAME=your_mailtrap_username
EMAIL_PASSWORD=your_mailtrap_password
```

**One more setup step this needs**: the email system reads its subject/body
from database-stored templates (so admins can edit copy without a
deploy), and none exist yet on a fresh database. Create the two the auth
flow actually uses:

```bash
# Get a super_admin access token first (log in via the admin panel, then
# check your browser's sessionStorage for the token, or use the API):
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"changeme123"}'
# copy the accessToken from the response, then:

TOKEN="<paste accessToken here>"

curl -X PUT http://localhost:5000/api/email-templates/verify_email \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"label":"Verify email","subject":"Verify your CarePaws account","bodyHtml":"Hi {{displayName}}, click here to verify: {{verifyUrl}}","isActive":true}'

curl -X PUT http://localhost:5000/api/email-templates/password_reset \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"label":"Password reset","subject":"Reset your CarePaws password","bodyHtml":"Hi {{displayName}}, reset here: {{resetUrl}}","isActive":true}'
```

Until you do this, registration/login/etc. still work fine — the email
send just no-ops with a logged warning (`emailSkipped: true`) instead of
throwing. Registration also returns `emailSent: false` in that case, and the
mobile app tells the new user and offers **Resend email** (also available
any time from Profile).

### Email verification

- **Where links go.** `verifyUrl` is the mobile deep link
  (`${MOBILE_APP_URL}verify-email?token=...`, default `carepaws://`) and
  stays the default. If `WEB_APP_URL` is set, the template also receives
  `webVerifyUrl` (`${WEB_APP_URL}/verify-email?token=...`), which lands on the
  admin build's public `/verify-email` page. That page only verifies the
  token; it doesn't sign members in. To show the web link, include
  `{{webVerifyUrl}}` in the `verify_email` template body, e.g.
  `Can't open the app? Verify in your browser: {{webVerifyUrl}}`.
- **Resend.** `POST /api/auth/resend-verification` (signed in, no body).
  A new token replaces the old one, so the previous link stops working.
  Limits: 60 seconds between sends and 3 per 15 minutes per user, plus 3 per
  15 minutes per IP (Redis-backed like the other limiters). 429 responses
  include `retryAfterSeconds`.
- **What requires a verified email** (`403`, `code: "EMAIL_NOT_VERIFIED"`):
  submitting an adoption or foster application (`POST /api/applications`),
  enrolling in a shift/appointment (`POST /api/appointments/:id/enroll`), and
  volunteer sign-up (`POST /api/volunteers/register`). Staff, admin and
  super_admin accounts are exempt. Browsing, chat, donations, emergency
  reports, login/refresh/logout, profile read/update, password reset and the
  verification endpoints are never blocked.
- **Existing accounts.** Accounts created before this change that are still
  unverified would be blocked from the actions above. Choose one, then run it
  yourself (nothing runs automatically; dry run by default):

  ```bash
  cd lykasServer
  # preview who would be affected
  node scripts/backfill-email-verification.js --mode=verify --cutoff=2026-10-20
  # mark members who logged in before the cutoff as verified
  node scripts/backfill-email-verification.js --mode=verify --cutoff=2026-10-20 --apply
  # or send them a fresh verification email instead
  node scripts/backfill-email-verification.js --mode=email --cutoff=2026-10-20 --apply
  ```

---

## 9. Running all the tests

```bash
cd lykasServer && npm test    # Jest + mongodb-memory-server
cd lykasAdmin && npm test     # Vitest + Testing Library
cd lykasUser && npm test      # Jest (jest-expo) + Testing Library
```

None of these were run for you in the environment that generated this
code — see each repo's README for why (no network access to install
dependencies at build time). **Run these yourself before trusting any of
this for production.** If something fails, that's the actual signal to
start debugging from, not this guide.

---

## 10. Troubleshooting

**"Redis client requested before connectRedis() completed"** — the server
can't reach Redis. Confirm `REDIS_URL` is correct and the Redis
container/process is actually running (`docker ps`, or `redis-cli ping`).

**Admin panel shows a blank page / network errors in the console** —
almost always `VITE_API_URL` pointing at the wrong place, or the backend
not running. Check the Network tab for the actual failing request.

**Mobile app can't reach the API from a physical phone** — see the LAN IP
note in §6. `localhost` on a phone means the phone.

**"This account does not have admin panel access"** on the admin login
screen — you're logging in with a `role: "user"` account. See §5.

**CORS errors in the browser console** — if you changed the admin panel's
port away from 5173, add it to `FRONTEND_URL` in `lykasServer/.env` (or
the `devOrigins` array in `lykasServer/src/server.js` for local dev).

**File uploads fail with "Unsupported file type"** — the MIME allowlist is
intentional (§11.6.3 of the project spec) — only jpeg/png/webp (and pdf
for documents) are accepted, by design.

**`npm install` fails / hangs** — if you're behind a restrictive network
or proxy, that's an environment issue outside this codebase; try a
different network or configure npm's proxy settings.

---

## 11. Where to go from here

- Each repo's own README (`lykasServer/README.md`,
  `lykasAdmin/README.md`, `lykasUser/README.md`) has more detail on that
  repo specifically — project structure, deployment, notable
  implementation choices.
- The root `README.md` explains how the three repos' auth, real-time,
  uploads, and payments actually connect to each other.
- `lykasServer/openapi.yaml` documents the API surface (partial coverage
  — see the `x-coverage-note` at the bottom of that file for what's not
  yet documented).
