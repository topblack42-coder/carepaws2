# Foster safeguards

How foster placements are extended, completed, escalated and returned, and who
owns the animal at each step. Rules live in `lykasServer/src/utils/fosterRules.js`
and are enforced in `fosterController.js`, not only in the admin screen.

## Rules

| Area | Rule |
|---|---|
| Extension length | 7 to 30 days per request, 30 days in total. Checked in the route schema **and** the controller, so a direct API call cannot shorten a placement. |
| Extension evidence | Needs a reason (10+ characters), the fosterer's agreement, and every due weekly report submitted **and reviewed**. If a report raised a health concern, a vet must agree. |
| Extension record | Each extension is stored in `Foster.extensions`: days, reason, who recommended, vet agreed (+ notes), fosterer agreed, who authorized and when, old and new end date. |
| Extension is not an ending | `PUT /api/foster/:id/extend` keeps the placement `active`. `EXTENDED` is no longer an outcome. |
| Outcomes | `PUT /api/foster/:id/end` accepts only `ADOPTED` or `RETURNED` (route schema and controller allowlist). Anything else is a 400 and nothing changes. |
| Reports gate | Completion needs all required reports submitted and reviewed. An **admin** can override with `completionException.reason`, which is stored. Plain staff get 403. |
| Health check | Reports are the fosterer's own account, not proof of health. Completion always needs a staff `finalHealthCheck` (notes, `vetVerified`). Any report with a health flag needs `vetVerified: true`. |
| Generic update | `PUT /api/foster/:id` can no longer change status, outcome, extensions or counters. It only edits dates, notes and the emergency contact. |

## Ownership

| Field on `Pet` | Meaning |
|---|---|
| `currentFosterer` | Temporary caregiver while the pet is in foster care. |
| `owner` | The adoption owner. Empty while fostering, so the shelter still owns the animal. |

- Approving a **foster** application sets `currentFosterer` only.
- Foster ends `ADOPTED`: `owner` = fosterer, `currentFosterer` cleared.
- Foster ends `RETURNED` or is cancelled: both cleared, pet is `Available`.
- `my-pets`, the baby book, vaccination reminders and realtime updates include `currentFosterer`, so the fosterer keeps access while fostering.

I kept the existing field name `owner` for the adoption owner instead of renaming it to `adoptionOwner`, to avoid touching every screen that reads it.

**Migration:** pets already in foster care still have the fosterer in `owner`. Run once:

```
cd lykasServer
node scripts/migrate-foster-ownership.js          # preview, changes nothing
node scripts/migrate-foster-ownership.js --apply
```

## End-date alerts and escalation

Daily job `foster_end_date_alerts` (07:40, also listed in the admin scheduled jobs page):

| When | Who is notified |
|---|---|
| 7 days before the end | Fosterer + all staff |
| 1 day before | Fosterer + all staff |
| Past the end date | Fosterer + all staff (with fosterer phone and emergency contact) |
| 3 days overdue | Fosterer + admins (escalation) |
| 7 days overdue | Fosterer + admins (escalation) |

Each stage is sent once per end date. Extending changes the end date, so alerts start over. The admin list also shows **Overdue Nd / Ends in Nd** badges.

## Emergency return

- `POST /api/foster/:id/return-request` (fosterer or staff): `urgency` = `routine` or `emergency`, plus a reason. All staff are notified with the fosterer's phone and emergency contact. A routine request can be raised to an emergency.
- `PUT /api/foster/:id/emergency-contact`: the fosterer (or staff) saves a name and phone.
- An **open emergency return** lets staff complete as `RETURNED` without the report gate; the reason is recorded as the exception. The health check is still required.
- Set `SHELTER_EMERGENCY_PHONE` in `lykasServer/.env`. It is returned to the app (`meta.shelterEmergencyPhone`) and shown as a tap-to-call line on the Foster Dashboard.

## Where things changed

- Server: `models/Foster.js`, `models/Pet.js`, `models/Notification.js`, `validators/foster.schema.js`, `routes/fosterRoutes.js`, `controllers/fosterController.js`, `controllers/applicationController.js`, `controllers/petController.js`, `routes/babyBookRoutes.js`, `jobs/reminderJobs.js`, `cronJob.js`, `controllers/scheduledJobController.js`, `utils/realtime.js`, `utils/fosterRules.js` (new), `scripts/migrate-foster-ownership.js` (new), `openapi.yaml`.
- Admin: `src/pages/Fosters.tsx` (extend form with reason and agreements, completion form with health check and admin exception, overdue and emergency badges).
- Mobile: `app/foster-dashboard.tsx` (end date, return request, emergency contact).

## Checks that were already in place

Two of the reported gaps were already partly covered, so the change there is defense in depth: the route schema already limited `extensionDays` to 7-30 and `outcome` to an enum. The controller itself did not re-check, and `PUT /api/foster/:id` could bypass both.
