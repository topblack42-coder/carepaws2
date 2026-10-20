import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import axios, { AxiosError } from "axios";
import * as SecureStore from "expo-secure-store";
import { api, tokenStore, setSessionExpiredHandler, setEmailNotVerifiedHandler } from "../utils/api";

/**
 * A minimal custom axios adapter so these tests exercise the real
 * request/response interceptor pipeline (including the retry-with-new-token
 * path) without making any real network calls.
 *
 * Real adapters (xhr/http) call axios's internal `settle()` themselves to
 * decide resolve vs. reject based on `validateStatus` — `dispatchRequest`
 * does not do this generically. A bare custom adapter has to replicate that
 * or every response (even 401s) will resolve instead of rejecting.
 */
function makeAdapter(handler: (config: InternalAxiosRequestConfig) => { status: number; data?: unknown }) {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const result = handler(config);
    const response: AxiosResponse = {
      data: (result.data ?? {}) as never,
      status: result.status,
      statusText: "",
      headers: {},
      config,
      request: {},
    };

    const validateStatus = config.validateStatus;
    if (!validateStatus || validateStatus(response.status)) {
      return response;
    }
    return Promise.reject(
      new AxiosError(
        `Request failed with status code ${response.status}`,
        String(Math.floor(response.status / 100)) === "4" ? AxiosError.ERR_BAD_REQUEST : AxiosError.ERR_BAD_RESPONSE,
        config,
        undefined,
        response
      )
    );
  };
}

describe("api response interceptor — 401 refresh-and-retry", () => {
  beforeEach(() => {
    jest.mocked(SecureStore.getItemAsync).mockImplementation((key: string) => {
      if (key === "carepaws_refresh_token") return Promise.resolve("valid-refresh-token");
      if (key === "carepaws_access_token") return Promise.resolve("old-access-token");
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refreshes and retries a 401 on a non-auth-flow endpoint like /api/auth/me", async () => {
    let callCount = 0;
    const adapter = makeAdapter((config) => {
      if (config.url === "/api/auth/me") {
        callCount += 1;
        if (callCount === 1) return { status: 401, data: { success: false, message: "Unauthorized" } };
        return { status: 200, data: { success: true, data: { _id: "u1" } } };
      }
      return { status: 200, data: {} };
    });

    const postSpy = jest.spyOn(axios, "post").mockResolvedValue({
      data: { data: { accessToken: "new-access-token", refreshToken: "new-refresh-token" } },
    });

    const res = await api.get("/api/auth/me", { adapter });

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
    expect(postSpy).toHaveBeenCalledWith(expect.stringContaining("/api/auth/refresh"), { refreshToken: "valid-refresh-token" });
  });

  it("persists the refreshed tokens via tokenStore.setTokens after a successful refresh", async () => {
    let callCount = 0;
    const adapter = makeAdapter((config) => {
      if (config.url === "/api/auth/me") {
        callCount += 1;
        if (callCount === 1) return { status: 401 };
        return { status: 200, data: {} };
      }
      return { status: 200, data: {} };
    });

    jest.spyOn(axios, "post").mockResolvedValue({
      data: { data: { accessToken: "new-access-token", refreshToken: "new-refresh-token" } },
    });
    const setTokensSpy = jest.spyOn(tokenStore, "setTokens");

    await api.get("/api/auth/me", { adapter });

    expect(setTokensSpy).toHaveBeenCalledWith("new-access-token", "new-refresh-token");
  });

  it("refreshes and retries a 401 on the favorites endpoint (/api/auth/favorites)", async () => {
    let callCount = 0;
    const adapter = makeAdapter((config) => {
      if (config.url === "/api/auth/favorites") {
        callCount += 1;
        if (callCount === 1) return { status: 401 };
        return { status: 200, data: { success: true, data: [] } };
      }
      return { status: 200, data: {} };
    });

    jest.spyOn(axios, "post").mockResolvedValue({
      data: { data: { accessToken: "new-access-token", refreshToken: "new-refresh-token" } },
    });

    const res = await api.get("/api/auth/favorites", { adapter });

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
  });

  it("does not attempt refresh-and-retry for a 401 on an auth-flow endpoint like /api/auth/login", async () => {
    const adapter = makeAdapter((config) => {
      if (config.url === "/api/auth/login") return { status: 401, data: { success: false, message: "Invalid credentials" } };
      return { status: 200, data: {} };
    });

    const postSpy = jest.spyOn(axios, "post").mockRejectedValue(new Error("refresh should not have been attempted"));

    await expect(
      api.post("/api/auth/login", { email: "a@b.com", password: "wrong" }, { adapter })
    ).rejects.toMatchObject({ response: { status: 401 } });

    expect(postSpy).not.toHaveBeenCalled();
  });

  it("does not attempt refresh-and-retry for a 401 on /api/auth/refresh itself", async () => {
    const adapter = makeAdapter((config) => {
      if (config.url === "/api/auth/refresh") return { status: 401, data: { success: false } };
      return { status: 200, data: {} };
    });

    const postSpy = jest.spyOn(axios, "post").mockRejectedValue(new Error("refresh should not have been attempted"));

    await expect(api.post("/api/auth/refresh", { refreshToken: "x" }, { adapter })).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(postSpy).not.toHaveBeenCalled();
  });
});

/**
 * Covers the fix where a network error, timeout, or 5xx while refreshing
 * was treated the same as the server confirming the refresh token is
 * invalid — wiping the stored session and forcing a full re-login over
 * what might be a few seconds of bad signal. Only an actual 401/403
 * response from POST /api/auth/refresh should do that now.
 */
describe("api response interceptor — network failures during refresh don't force a logout", () => {
  beforeEach(() => {
    jest.mocked(SecureStore.getItemAsync).mockImplementation((key: string) => {
      if (key === "carepaws_refresh_token") return Promise.resolve("valid-refresh-token");
      if (key === "carepaws_access_token") return Promise.resolve("old-access-token");
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not clear stored tokens or fire the session-expired handler when the refresh call itself fails on the network", async () => {
    let meCallCount = 0;
    const adapter = makeAdapter((config) => {
      if (config.url === "/api/auth/me") {
        meCallCount += 1;
        return { status: 401, data: { success: false, message: "Unauthorized" } };
      }
      return { status: 200, data: {} };
    });

    // No `response` on this error — exactly what a dropped connection,
    // timeout, or DNS failure looks like to axios, as opposed to a server
    // actually replying with 401.
    jest.spyOn(axios, "post").mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));
    const clearSpy = jest.spyOn(tokenStore, "clear");
    const sessionExpired = jest.fn();
    setSessionExpiredHandler(sessionExpired);

    await expect(api.get("/api/auth/me", { adapter })).rejects.toMatchObject({ response: { status: 401 } });

    expect(meCallCount).toBe(1); // no retry attempted — the refresh never produced a usable token
    expect(clearSpy).not.toHaveBeenCalled();
    expect(sessionExpired).not.toHaveBeenCalled();
  });

  it("still clears stored tokens and fires the session-expired handler when the server confirms the refresh token is invalid", async () => {
    const adapter = makeAdapter((config) => {
      if (config.url === "/api/auth/me") return { status: 401, data: { success: false, message: "Unauthorized" } };
      return { status: 200, data: {} };
    });

    jest.spyOn(axios, "post").mockRejectedValue(
      new AxiosError("Request failed with status code 401", AxiosError.ERR_BAD_REQUEST, undefined, undefined, {
        status: 401,
        data: { success: false, message: "Invalid or expired refresh token" },
      } as AxiosResponse)
    );
    const clearSpy = jest.spyOn(tokenStore, "clear");
    const sessionExpired = jest.fn();
    setSessionExpiredHandler(sessionExpired);

    await expect(api.get("/api/auth/me", { adapter })).rejects.toMatchObject({ response: { status: 401 } });

    expect(clearSpy).toHaveBeenCalled();
    expect(sessionExpired).toHaveBeenCalled();
  });
});

describe("api response interceptor — 403 EMAIL_NOT_VERIFIED", () => {
  afterEach(() => setEmailNotVerifiedHandler(null));

  it("calls the email-not-verified handler and still rejects with the original error", async () => {
    const adapter = makeAdapter(() => ({
      status: 403,
      data: { success: false, code: "EMAIL_NOT_VERIFIED", message: "Please verify your email to continue" },
    }));
    const handler = jest.fn();
    setEmailNotVerifiedHandler(handler);

    await expect(api.post("/api/applications", {}, { adapter })).rejects.toMatchObject({ response: { status: 403 } });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores other 403s", async () => {
    const adapter = makeAdapter(() => ({ status: 403, data: { success: false, message: "Insufficient role" } }));
    const handler = jest.fn();
    setEmailNotVerifiedHandler(handler);

    await expect(api.post("/api/applications", {}, { adapter })).rejects.toMatchObject({ response: { status: 403 } });

    expect(handler).not.toHaveBeenCalled();
  });
});
