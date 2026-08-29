import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import * as SecureStore from "expo-secure-store";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:5000";

export interface ApiErrorShape {
  success: false;
  message: string;
  errors?: { field: string; message: string }[];
  requestId?: string;
}

const ACCESS_TOKEN_KEY = "carepaws_access_token";
const REFRESH_TOKEN_KEY = "carepaws_refresh_token";

/**
 * Token storage backed by expo-secure-store (iOS Keychain / Android
 * Keystore) rather than AsyncStorage, which is unencrypted on-device
 * JSON — see §6.5. AsyncStorage is reserved for genuinely non-sensitive
 * UI state elsewhere in the app (onboarding-seen flags, filter prefs).
 */
export const tokenStore = {
  async getAccessToken() {
    return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  },
  async getRefreshToken() {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  },
  async setTokens(accessToken: string, refreshToken: string) {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
    ]);
  },
  async clear() {
    await Promise.all([SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY), SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)]);
  },
};

export const api = axios.create({ baseURL: API_URL, timeout: 20000 });

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await tokenStore.getAccessToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const AUTH_FLOW_PATHS = ["/auth/login", "/auth/register", "/auth/google", "/auth/refresh"];

/** The HTTP status code of an error, or undefined if it never got a response (network drop, timeout, DNS failure, etc.). */
export function getResponseStatus(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}

type RefreshResult = { accessToken: string } | { error: "invalid" | "network" | "missing_refresh_token" };

let refreshInFlight: Promise<RefreshResult> | null = null;
let onSessionExpired: (() => void) | null = null;

/** Called once from the root layout so the API client can redirect to login on a hard session failure. */
export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

async function refreshAccessToken(): Promise<RefreshResult> {
  const refreshToken = await tokenStore.getRefreshToken();
  if (!refreshToken) {
    // Distinguish between a confirmed-invalid refresh (server told us) and
    // a missing refresh token locally (client-side parsing/storage issue).
    console.warn('[api] refreshAccessToken called but no refresh token found');
    return { error: "missing_refresh_token" };
  }

  try {
    const res = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
    const { accessToken, refreshToken: newRefreshToken } = res.data.data;
    await tokenStore.setTokens(accessToken, newRefreshToken);
    return { accessToken };
  } catch (err) {
    // Only wipe the stored session when the server actually told us the
    // refresh token is no good (401/403 — expired, revoked, reused, or the
    // account is no longer active). A network drop, timeout, or 5xx just
    // means we couldn't ask right now; the refresh token itself may still
    // be perfectly valid, so keep it and let the next attempt retry once
    // connectivity is back, instead of forcing a full re-login over what
    // might be a few seconds of bad signal.
    const status = getResponseStatus(err);
    if (status === 401 || status === 403) {
      await tokenStore.clear();
      return { error: "invalid" };
    }
    return { error: "network" };
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorShape>) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };

    if (
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !AUTH_FLOW_PATHS.some((p) => original.url?.includes(p))
    ) {
      original._retried = true;

      if (!refreshInFlight) {
        refreshInFlight = refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
      }

      const result = await refreshInFlight;
      if (result && "accessToken" in result) {
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${result.accessToken}`;
        return api(original);
      }

      // Only bounce the app to the login screen for a confirmed-invalid
      // session. On "network", leave the user's local session state alone —
      // the original error below still surfaces to the caller so this one
      // request fails, but we don't sign them out over a connectivity blip.
      if (result && result.error === "invalid") {
        onSessionExpired?.();
      }
      // For missing_refresh_token or network, do not call onSessionExpired here;
      // allow the calling code / later attempts to surface the condition so
      // we avoid clearing a possibly-valid session over a local storage bug.
    }

    return Promise.reject(error);
  }
);

/** Pulls a human-readable message out of the shared error envelope (§8.1). */
export function getApiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiErrorShape | undefined;
    if (data?.errors?.length) {
      return data.errors.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join(", ");
    }
    if (data?.message) return data.message;
    if (err.code === "ECONNABORTED") return "The request timed out — check your connection and try again.";
    if (!err.response) return "Can't reach the server — check your internet connection and try again.";
  }
  return fallback;
}
