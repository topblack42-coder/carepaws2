const nodemailer = require("nodemailer");
const logger = require("./logger");

let transporter = null;
let configured = false;

// Mailjet Send API (HTTPS, port 443). Preferred on hosts that block outbound
// SMTP ports (e.g. Render free tier). Enabled when both keys are set.
function mailjetEnabled() {
  return Boolean(process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY && process.env.EMAIL_FROM);
}

async function sendViaMailjet({ to, subject, html }) {
  const auth = Buffer.from(`${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`).toString("base64");
  const res = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: process.env.EMAIL_FROM, Name: process.env.EMAIL_FROM_NAME || "CarePaws" },
          To: [{ Email: to }],
          Subject: subject,
          HTMLPart: html,
        },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Mailjet API ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
}

function buildTransporter() {
  if (mailjetEnabled()) {
    configured = true;
    return null; // API mode: no SMTP transporter needed
  }

  const { EMAIL_SERVICE, EMAIL_USER, EMAIL_PASSWORD, EMAIL_HOST, EMAIL_PORT, EMAIL_USERNAME } = process.env;

  if (EMAIL_SERVICE && EMAIL_USER && EMAIL_PASSWORD) {
    configured = true;
    return nodemailer.createTransport({
      service: EMAIL_SERVICE,
      auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD },
    });
  }

  if (EMAIL_HOST && EMAIL_PORT && EMAIL_USERNAME && EMAIL_PASSWORD) {
    configured = true;
    return nodemailer.createTransport({
      host: EMAIL_HOST,
      port: Number(EMAIL_PORT),
      auth: { user: EMAIL_USERNAME, pass: EMAIL_PASSWORD },
    });
  }

  logger.warn("No email transport configured (EMAIL_SERVICE/EMAIL_USER/EMAIL_PASSWORD or EMAIL_HOST/EMAIL_PORT/EMAIL_USERNAME/EMAIL_PASSWORD) — emails will be skipped");
  configured = false;
  return null;
}

transporter = buildTransporter();

/**
 * Renders a stored EmailTemplate's {{variable}} placeholders against a
 * plain data object.
 */
function renderTemplate(str, data = {}) {
  return str.replace(/{{\s*(\w+)\s*}}/g, (_, key) => (key in data ? String(data[key]) : ""));
}

/**
 * Sends an email using a DB-stored EmailTemplate (by key) so admins can
 * edit copy without a deploy. Degrades gracefully — if no transport is
 * configured, logs and returns { emailSkipped: true } instead of
 * throwing, so signup/reset flows still succeed in dev without SMTP set up.
 */
async function sendTemplatedEmail({ to, templateKey, data = {} }) {
  const EmailTemplate = require("../models/EmailTemplate");
  const template = await EmailTemplate.findOne({ key: templateKey, isActive: true });

  if (!template) {
    logger.error({ templateKey }, "Email template not found or inactive");
    return { emailSkipped: true, reason: "template_not_found" };
  }

  return sendRawEmail({
    to,
    subject: renderTemplate(template.subject, data),
    html: renderTemplate(template.bodyHtml, data),
  });
}

async function sendRawEmail({ to, subject, html }) {
  if (!configured || (!transporter && !mailjetEnabled())) {
    logger.warn({ to, subject }, "Email skipped — no transport configured");
    return { emailSkipped: true, reason: "not_configured" };
  }

  try {
    if (mailjetEnabled()) {
      await sendViaMailjet({ to, subject, html });
      return { emailSkipped: false };
    }
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.EMAIL_USERNAME,
      to,
      subject,
      html,
    });
    return { emailSkipped: false };
  } catch (err) {
    logger.error({ err, to, subject }, "Failed to send email");
    return { emailSkipped: true, reason: "send_failed" };
  }
}

module.exports = { sendTemplatedEmail, sendRawEmail, renderTemplate };
