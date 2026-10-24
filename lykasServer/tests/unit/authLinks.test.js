const { buildResetUrls, checkPublicUrlConfig } = require("../../src/utils/authLinks");

describe("buildResetUrls", () => {
  const token = "a".repeat(64);

  it("returns an https resetUrl on the API plus the deep link", () => {
    const urls = buildResetUrls(token, { API_PUBLIC_URL: "https://api.example.com/" });
    expect(urls.resetUrl).toBe(`https://api.example.com/api/auth/reset-password-link?token=${token}`);
    expect(urls.appResetUrl).toBe(`carepaws://reset-password?token=${token}`);
    expect(urls).not.toHaveProperty("webResetUrl");
  });

  it("falls back to RENDER_EXTERNAL_URL, and strips trailing slashes", () => {
    const urls = buildResetUrls(token, { RENDER_EXTERNAL_URL: "https://x.onrender.com//" });
    expect(urls.resetUrl.startsWith("https://x.onrender.com/api/auth/reset-password-link?")).toBe(true);
  });

  it("adds webResetUrl only when WEB_APP_URL is set", () => {
    const urls = buildResetUrls(token, { API_PUBLIC_URL: "https://api.example.com", WEB_APP_URL: "https://admin.example.com/" });
    expect(urls.webResetUrl).toBe(`https://admin.example.com/reset-password?token=${token}`);
  });

  it("falls back to the carepaws:// link when no public API URL is configured", () => {
    const urls = buildResetUrls(token, {});
    expect(urls.resetUrl).toBe(urls.appResetUrl);
  });
});

describe("checkPublicUrlConfig", () => {
  it("warns when neither API_PUBLIC_URL nor RENDER_EXTERNAL_URL is set", () => {
    expect(checkPublicUrlConfig({})).toMatch(/API_PUBLIC_URL/);
  });
  it("is quiet when configured", () => {
    expect(checkPublicUrlConfig({ API_PUBLIC_URL: "https://api.example.com" })).toBeNull();
  });
  it("warns about a non-https URL in production only", () => {
    expect(checkPublicUrlConfig({ API_PUBLIC_URL: "http://api.example.com", NODE_ENV: "production" })).toMatch(/https/);
    expect(checkPublicUrlConfig({ API_PUBLIC_URL: "http://localhost:5000", NODE_ENV: "development" })).toBeNull();
  });
});
