const request = require("supertest");

jest.mock("../../src/middleware/rateLimitMiddleware", () => ({
  globalLimiter: (req, res, next) => next(),
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  passwordResetLimiter: (req, res, next) => next(),
  resendVerificationLimiter: (req, res, next) => next(),
  resetLinkLimiter: (req, res, next) => next(),
  webhookLimiter: (req, res, next) => next(),
}));

// Capture outgoing mail but keep the real renderTemplate for the render test.
jest.mock("../../src/utils/emailService", () => ({
  ...jest.requireActual("../../src/utils/emailService"),
  sendTemplatedEmail: jest.fn(),
}));

const { app } = require("../../src/server");
const User = require("../../src/models/User");
const EmailTemplate = require("../../src/models/EmailTemplate");
const { sendTemplatedEmail, renderTemplate } = require("../../src/utils/emailService");
const { EMAIL_TEMPLATE_DEFAULTS, syncEmailTemplates } = require("../../src/utils/emailTemplateDefaults");

const API = "https://api.example.com";

beforeEach(() => {
  process.env.API_PUBLIC_URL = `${API}/`;
  delete process.env.RENDER_EXTERNAL_URL;
  delete process.env.WEB_APP_URL;
  sendTemplatedEmail.mockReset();
  sendTemplatedEmail.mockResolvedValue({ emailSkipped: false });
});

async function requestReset(email = "member@example.com") {
  await request(app).post("/api/auth/register").send({ displayName: "Member", email, password: "password123" });
  sendTemplatedEmail.mockClear();
  const res = await request(app).post("/api/auth/forgot-password").send({ email });
  const call = sendTemplatedEmail.mock.calls.find(([arg]) => arg.templateKey === "password_reset");
  return { res, data: call?.[0].data };
}

describe("forgot-password email data", () => {
  it("sends an https resetUrl plus the app deep link, and still responds success", async () => {
    const { res, data } = await requestReset();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(data.displayName).toBe("Member");
    expect(data.resetUrl).toMatch(new RegExp(`^${API}/api/auth/reset-password-link\\?token=[a-f0-9]{64}$`));
    expect(data.appResetUrl).toMatch(/^carepaws:\/\/reset-password\?token=[a-f0-9]{64}$/);
    expect(data).not.toHaveProperty("webResetUrl");
  });

  it("includes webResetUrl when WEB_APP_URL is set", async () => {
    process.env.WEB_APP_URL = "https://admin.example.com/";
    const { data } = await requestReset();
    expect(data.webResetUrl).toMatch(/^https:\/\/admin\.example\.com\/reset-password\?token=[a-f0-9]{64}$/);
  });

  it("still returns the generic success for an unknown email", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/reset-password-link", () => {
  it("returns an HTML bridge page with the deep link and does not modify the user", async () => {
    const { data } = await requestReset();
    const token = /token=([a-f0-9]+)/.exec(data.resetUrl)[1];
    const select = "+resetPasswordToken +resetPasswordExpires";
    const before = (await User.findOne({ email: "member@example.com" }).select(select)).toObject();

    const res = await request(app).get(`/api/auth/reset-password-link?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.text).toContain(`href="carepaws://reset-password?token=${token}"`);
    expect(res.text).toContain("Open CarePaws app");
    expect(res.text).toContain("window.location");
    expect(res.text).not.toContain("Open in browser"); // WEB_APP_URL unset

    const after = (await User.findOne({ email: "member@example.com" }).select(select)).toObject();
    expect(after).toEqual(before);
    // the token still works afterwards (the bridge did not consume it)
    const reset = await request(app).post("/api/auth/reset-password").send({ token, password: "newpassword123" });
    expect(reset.status).toBe(200);
  });

  it("shows an Open in browser link when WEB_APP_URL is set", async () => {
    process.env.WEB_APP_URL = "https://admin.example.com";
    const token = "b".repeat(64);
    const res = await request(app).get(`/api/auth/reset-password-link?token=${token}`);
    expect(res.text).toContain(`href="https://admin.example.com/reset-password?token=${token}"`);
    expect(res.text).toContain("Open in browser");
  });

  it("URL-encodes and HTML-escapes the token", async () => {
    const evil = `"><script>alert(1)</script>`;
    const res = await request(app).get("/api/auth/reset-password-link").query({ token: evil });
    expect(res.text).not.toContain("<script>alert(1)");
    expect(res.text).not.toContain(evil);
    expect(res.text).toContain(encodeURIComponent(evil));
  });

  it("rejects a missing token without leaking anything", async () => {
    const res = await request(app).get("/api/auth/reset-password-link");
    expect(res.status).toBe(400);
    expect(res.text).not.toContain("carepaws://");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("allows only its own inline script via CSP nonce", async () => {
    const res = await request(app).get(`/api/auth/reset-password-link?token=${"c".repeat(64)}`);
    const nonce = /script-src 'nonce-([^']+)'/.exec(res.headers["content-security-policy"])[1];
    expect(res.text).toContain(`<script nonce="${nonce}">`);
  });
});

describe("default email templates", () => {
  const data = { displayName: "Mark", resetUrl: `${API}/r?token=abc`, verifyUrl: `${API}/v?token=abc` };

  it("render a real <a href=\"https://...\"> button and the raw link as text", () => {
    const reset = EMAIL_TEMPLATE_DEFAULTS.find((t) => t.key === "password_reset");
    const html = renderTemplate(reset.bodyHtml, data);
    expect(html).toContain(`<a href="${data.resetUrl}"`);
    expect(html).toContain("Reset my password</a>");
    expect(html).toContain(`copy this link: ${data.resetUrl}`);
    expect(html).toContain("Hi Mark,");

    const verify = EMAIL_TEMPLATE_DEFAULTS.find((t) => t.key === "verify_email");
    const vhtml = renderTemplate(verify.bodyHtml, data);
    expect(vhtml).toContain(`<a href="${data.verifyUrl}"`);
    expect(vhtml).toContain("Verify my email</a>");
  });

  it("syncEmailTemplates is a dry run by default, updates stale bodies, and is idempotent", async () => {
    await EmailTemplate.create({ key: "password_reset", label: "Password reset", subject: "Reset", bodyHtml: "Hi {{displayName}}, {{resetUrl}}", isActive: false });

    const dry = await syncEmailTemplates();
    expect(dry).toEqual([{ key: "password_reset", action: "update" }, { key: "verify_email", action: "create" }]);
    expect(await EmailTemplate.countDocuments()).toBe(1);

    await syncEmailTemplates({ apply: true });
    const stored = await EmailTemplate.findOne({ key: "password_reset" });
    expect(stored.bodyHtml).toContain('<a href="{{resetUrl}}"');
    expect(stored.isActive).toBe(false); // existing activation state is left alone
    expect((await EmailTemplate.findOne({ key: "verify_email" })).isActive).toBe(true);

    const again = await syncEmailTemplates({ apply: true });
    expect(again.every((r) => r.action === "unchanged")).toBe(true);
  });
});
