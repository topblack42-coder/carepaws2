const EmailTemplate = require("../models/EmailTemplate");

// Email-safe HTML: inline styles only, a real <a href> button, and the raw URL
// repeated as plain text so the link is always usable.
const BUTTON_STYLE =
  "display:inline-block;padding:12px 24px;background:#1E6B45;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600";

function body({ intro, url, label, note }) {
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1f2937">` +
    `<p>Hi {{displayName}},</p>` +
    `<p>${intro}</p>` +
    `<p style="margin:24px 0"><a href="{{${url}}}" style="${BUTTON_STYLE}">${label}</a></p>` +
    `<p style="font-size:14px;color:#4b5563">If the button doesn't work, copy this link: {{${url}}}</p>` +
    `<p style="font-size:14px;color:#4b5563">${note}</p>` +
    `<p>The CarePaws team</p>` +
    `</div>`
  );
}

const EMAIL_TEMPLATE_DEFAULTS = [
  {
    key: "password_reset",
    label: "Password reset",
    subject: "Reset your CarePaws password",
    variables: ["displayName", "resetUrl", "appResetUrl", "webResetUrl"],
    bodyHtml: body({
      intro: "We received a request to reset your CarePaws password. Tap the button below to choose a new one.",
      url: "resetUrl",
      label: "Reset my password",
      note: "This link expires in 1 hour. If you didn't ask for this, you can ignore this email.",
    }),
  },
  {
    key: "verify_email",
    label: "Verify email",
    subject: "Verify your CarePaws account",
    variables: ["displayName", "verifyUrl", "appVerifyUrl", "webVerifyUrl"],
    bodyHtml: body({
      intro: "Welcome to CarePaws! Please confirm your email address to finish setting up your account.",
      url: "verifyUrl",
      label: "Verify my email",
      note: "This link expires in 24 hours. If you didn't create a CarePaws account, you can ignore this email.",
    }),
  },
];

/**
 * Idempotent upsert of the default templates. Overwrites label/subject/body/
 * variables of existing templates (that is the point: fixing stored bodies
 * that have no <a href>) but leaves isActive alone on existing rows.
 * With apply=false nothing is written. Returns [{ key, action }] where action
 * is "create" | "update" | "unchanged".
 */
async function syncEmailTemplates({ apply = false, defaults = EMAIL_TEMPLATE_DEFAULTS } = {}) {
  const results = [];
  for (const def of defaults) {
    const existing = await EmailTemplate.findOne({ key: def.key });
    let action;
    if (!existing) action = "create";
    else if (
      existing.bodyHtml !== def.bodyHtml ||
      existing.subject !== def.subject ||
      existing.label !== def.label ||
      JSON.stringify(existing.variables || []) !== JSON.stringify(def.variables)
    ) action = "update";
    else action = "unchanged";

    if (apply && action !== "unchanged") {
      await EmailTemplate.updateOne(
        { key: def.key },
        { $set: { label: def.label, subject: def.subject, bodyHtml: def.bodyHtml, variables: def.variables }, $setOnInsert: { isActive: true } },
        { upsert: true }
      );
    }
    results.push({ key: def.key, action });
  }
  return results;
}

module.exports = { EMAIL_TEMPLATE_DEFAULTS, syncEmailTemplates };
