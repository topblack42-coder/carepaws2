/**
 * Turns raw audit-log entries into plain-English text for non-technical staff.
 * Used by the Audit Trails page (GET /api/audit-logs).
 */
const User = require("../models/User");
const Pet = require("../models/Pet");
const Application = require("../models/Application");
const Volunteer = require("../models/Volunteer");
const InKindDonation = require("../models/InKindDonation");

// Short, friendly name for each action code.
const ACTION_LABELS = {
  "pet.create": "Added a pet",
  "pet.update": "Edited a pet",
  "pet.video.remove": "Removed a pet video",
  "pet.delete": "Moved a pet to the archive",
  "pet.restore": "Restored a pet from the archive",
  "pet.permanent_delete": "Permanently deleted a pet",
  "application.status_update": "Decided on an application",
  "application.stage_update": "Moved an application to a new step",
  "application.delete": "Deleted an application",
  "inkind_donation.status_update": "Updated a donation",
  "user.role_update": "Changed a user's role",
  "user.status_update": "Changed an account's status",
  "user.delete": "Moved an account to the archive",
  "user.permanent_delete": "Permanently deleted an account",
  "user.force_reset": "Forced a password reset",
  "volunteer.status_update": "Updated a volunteer request",
  "volunteer.delete": "Deleted a volunteer request",
};

const ENTITY_LABELS = {
  Pet: "Pet",
  User: "Account",
  Application: "Application",
  Volunteer: "Volunteer",
  InKindDonation: "Donation",
  Shelter: "Shelter",
};

const STAGE_LABELS = {
  submitted: "Submitted",
  document_review: "Document review",
  interview: "Interview",
  home_visit: "Home visit",
  risk_assessment: "Risk assessment",
  approved: "Approved",
  adoption_scheduled: "Adoption scheduled",
  completed: "Completed",
  rejected: "Rejected",
};

const ROLE_LABELS = { user: "Adopter / member", staff: "Staff", admin: "Admin", super_admin: "Super admin" };

const pretty = (value, map = {}) => {
  if (value === undefined || value === null || value === "") return "unknown";
  return map[value] || String(value).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
};

function actionLabel(action) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  // Unknown future actions: "thing.some_change" -> "Thing some change"
  return String(action || "Unknown action").replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Action codes whose friendly label contains the search text. */
function actionsMatching(text) {
  const needle = String(text).toLowerCase();
  return Object.entries(ACTION_LABELS)
    .filter(([code, label]) => label.toLowerCase().includes(needle) || code.includes(needle))
    .map(([code]) => code);
}

/**
 * Looks up the records the log entries point at (in a handful of batched
 * queries) and returns a Map of logId -> { user, subject, description }.
 */
async function describeEntries(entries) {
  const idsOf = (type) => [...new Set(entries.filter((e) => e.entityType === type && e.entityId).map((e) => String(e.entityId)))];

  const [pets, apps, volunteers, donations, users] = await Promise.all([
    Pet.find({ _id: { $in: idsOf("Pet") } }).select("name").lean(),
    Application.find({ _id: { $in: idsOf("Application") } }).select("pet applicant type").lean(),
    Volunteer.find({ _id: { $in: idsOf("Volunteer") } }).select("user").lean(),
    InKindDonation.find({ _id: { $in: idsOf("InKindDonation") } }).select("name donatedBy").lean(),
    User.find({ _id: { $in: idsOf("User") } }).select("displayName email").lean(),
  ]);

  const byId = (list) => new Map(list.map((d) => [String(d._id), d]));
  const petMap = byId(pets);
  const appMap = byId(apps);
  const volMap = byId(volunteers);
  const donMap = byId(donations);
  const userMap = byId(users);

  // Second round: pets and people referenced by the records above.
  const extraPetIds = apps.map((a) => String(a.pet)).filter((id) => !petMap.has(id));
  const personIds = new Set([
    ...apps.map((a) => String(a.applicant)),
    ...volunteers.map((v) => String(v.user)),
    ...donations.filter((d) => d.donatedBy).map((d) => String(d.donatedBy)),
    ...entries.filter((e) => e.targetUser).map((e) => String(e.targetUser)),
  ]);
  const [morePets, people] = await Promise.all([
    extraPetIds.length ? Pet.find({ _id: { $in: extraPetIds } }).select("name").lean() : [],
    User.find({ _id: { $in: [...personIds] } }).select("displayName email").lean(),
  ]);
  morePets.forEach((p) => petMap.set(String(p._id), p));
  const peopleMap = byId(people);
  userMap.forEach((u, id) => peopleMap.set(id, u));

  const result = new Map();

  for (const entry of entries) {
    const prev = entry.previousValues || {};
    const next = entry.newValues || {};
    const id = String(entry.entityId || "");
    let person = entry.targetUser ? peopleMap.get(String(entry.targetUser)) : null;
    let subject = null;
    let description = actionLabel(entry.action);

    switch (entry.entityType) {
      case "Pet": {
        const pet = petMap.get(id);
        const name = pet?.name || next.name;
        subject = name ? `Pet: ${name}` : "Pet (no longer exists)";
        break;
      }
      case "User": {
        person = person || peopleMap.get(id);
        subject = person ? null : "Account (no longer exists)";
        break;
      }
      case "Application": {
        const app = appMap.get(id);
        if (app) {
          person = person || peopleMap.get(String(app.applicant));
          const pet = petMap.get(String(app.pet));
          subject = `${app.type === "foster" ? "Foster" : "Adoption"} application${pet ? ` for ${pet.name}` : ""}`;
        } else {
          subject = "Application (no longer exists)";
        }
        break;
      }
      case "Volunteer": {
        const vol = volMap.get(id);
        if (vol) person = person || peopleMap.get(String(vol.user));
        subject = "Volunteer request";
        break;
      }
      case "InKindDonation": {
        const don = donMap.get(id);
        if (don?.donatedBy) person = person || peopleMap.get(String(don.donatedBy));
        subject = don ? `Donation: ${don.name}` : "Donation (no longer exists)";
        break;
      }
      default:
        break;
    }

    const who = person ? person.displayName : null;
    const forWho = who ? ` for ${who}` : "";

    switch (entry.action) {
      case "application.status_update":
        description = `${next.status === "approved" ? "Approved" : next.status === "rejected" ? "Rejected" : "Updated"} the ${subject?.toLowerCase() || "application"}${forWho}.`;
        break;
      case "application.stage_update":
        description = `Moved the ${subject?.toLowerCase() || "application"}${forWho} from "${pretty(prev.stage, STAGE_LABELS)}" to "${pretty(next.stage, STAGE_LABELS)}".`;
        break;
      case "application.delete":
        description = `Deleted the ${subject?.toLowerCase() || "application"}${forWho}.`;
        break;
      case "user.role_update":
        description = `Changed ${who || "an account"}'s role from ${pretty(prev.role, ROLE_LABELS)} to ${pretty(next.role, ROLE_LABELS)}.`;
        break;
      case "user.status_update":
        description = `Changed ${who ? `${who}'s` : "an"} account status from ${pretty(prev.status)} to ${pretty(next.status)}.`;
        break;
      case "user.delete":
        description = `Moved ${who ? `${who}'s` : "an"} account to the archive.`;
        break;
      case "user.permanent_delete":
        description = `Permanently deleted ${who ? `${who}'s` : "an"} account.`;
        break;
      case "user.force_reset":
        description = `Made ${who || "a user"} choose a new password at next login.`;
        break;
      case "volunteer.status_update":
        description = `Changed a volunteer request${forWho} from ${pretty(prev.status)} to ${pretty(next.status)}.`;
        break;
      case "volunteer.delete":
        description = `Deleted a volunteer request${forWho}.`;
        break;
      case "inkind_donation.status_update":
        description = `Updated the ${subject?.toLowerCase() || "donation"}${forWho}.`;
        break;
      case "pet.create":
      case "pet.update":
      case "pet.video.remove":
      case "pet.delete":
      case "pet.restore":
      case "pet.permanent_delete":
        description = `${actionLabel(entry.action)}${subject ? ` (${subject.replace("Pet: ", "")})` : ""}.`;
        break;
      default:
        description = `${description}.`;
    }

    result.set(String(entry._id), {
      user: person ? { displayName: person.displayName, email: person.email } : null,
      subject,
      description,
    });
  }

  return result;
}

module.exports = { actionLabel, actionsMatching, describeEntries, ENTITY_LABELS };
