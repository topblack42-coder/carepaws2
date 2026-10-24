/**
 * Links used in password-reset emails.
 *
 * Gmail and most mail clients only linkify http(s) URLs, so the link that goes
 * in the email body ({{resetUrl}}) must be an https URL on the API. That URL
 * lands on a small bridge page (GET /api/auth/reset-password-link) which then
 * hands off to the app via the carepaws:// deep link.
 *
 * Mirrors how emailVerification.js builds verifyUrl / appVerifyUrl /
 * webVerifyUrl. RENDER_EXTERNAL_URL is set automatically by Render.
 */

// Fixed on purpose: this must match the "scheme" in lykasUser/app.json.
const APP_SCHEME_URL = "carepaws://";

function trimSlashes(url) {
  return String(url).replace(/\/+$/, "");
}

function getApiBaseUrl(env = process.env) {
  const base = env.API_PUBLIC_URL || env.RENDER_EXTERNAL_URL;
  return base ? trimSlashes(base) : null;
}

function getWebBaseUrl(env = process.env) {
  return env.WEB_APP_URL ? trimSlashes(env.WEB_APP_URL) : null;
}

/**
 * Returns { resetUrl, appResetUrl, webResetUrl? } for a raw reset token.
 * resetUrl falls back to the carepaws:// link when no public API URL is
 * configured (that link is not clickable in Gmail; see checkPublicUrlConfig).
 * webResetUrl is omitted entirely when WEB_APP_URL is unset, so the key never
 * renders as the string "undefined" in a template.
 */
function buildResetUrls(token, env = process.env) {
  const encoded = encodeURIComponent(token);
  const appResetUrl = `${APP_SCHEME_URL}reset-password?token=${encoded}`;
  const apiBase = getApiBaseUrl(env);
  const urls = {
    resetUrl: apiBase ? `${apiBase}/api/auth/reset-password-link?token=${encoded}` : appResetUrl,
    appResetUrl,
  };
  const webBase = getWebBaseUrl(env);
  if (webBase) urls.webResetUrl = `${webBase}/reset-password?token=${encoded}`;
  return urls;
}

/** One-time boot warning text, or null when links will be clickable. */
function checkPublicUrlConfig(env = process.env) {
  const base = getApiBaseUrl(env);
  if (!base) {
    return (
      "API_PUBLIC_URL (and RENDER_EXTERNAL_URL) is not set. Password-reset and " +
      "verify-email links will fall back to carepaws:// deep links, which Gmail " +
      "does not make clickable. Set API_PUBLIC_URL to this API's public https URL " +
      "(e.g. https://your-service.onrender.com). See SETUP.md > Email."
    );
  }
  if (env.NODE_ENV === "production" && !/^https:\/\//i.test(base)) {
    return `API_PUBLIC_URL / RENDER_EXTERNAL_URL (${base}) is not an https:// URL; email links should use https in production.`;
  }
  return null;
}

module.exports = { APP_SCHEME_URL, getApiBaseUrl, getWebBaseUrl, buildResetUrls, checkPublicUrlConfig };
