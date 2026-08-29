import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export interface ApiErrorShape {
  success: false;
  message: string;
  errors?: { field: string; message: string }[];
  requestId?: string;
}

const ACCESS_TOKEN_KEY = "carepaws_admin_access_token";
const REFRESH_TOKEN_KEY = "carepaws_admin_refresh_token";

// The admin panel keeps tokens in memory + sessionStorage rather than
// localStorage (§8.1 — avoid localStorage for anything sensitive where
// avoidable). sessionStorage still survives a page reload within the
// same tab, which a pure in-memory store would not, while not
// persisting across browser restarts the way localStorage does.
export const tokenStore = {
  getAccessToken: () => sessionStorage.getItem(ACCESS_TOKEN_KEY),
  getRefreshToken: () => sessionStorage.getItem(REFRESH_TOKEN_KEY),
  setTokens: (accessToken: string, refreshToken: string) => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },
  clear: () => {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.getAccessToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const AUTH_FLOW_PATHS = ["/auth/login", "/auth/register", "/auth/google", "/auth/refresh"];

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = tokenStore.getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
    const { accessToken, refreshToken: newRefreshToken } = res.data.data;
    tokenStore.setTokens(accessToken, newRefreshToken);
    return accessToken;
  } catch {
    tokenStore.clear();
    return null;
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

      const newToken = await refreshInFlight;
      if (newToken) {
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }

      // Refresh failed — bounce to login.
      window.location.href = "/login";
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
    // No parseable server message on an HTTP-level failure (e.g. a 403
    // from something in front of the API — CORS, a WAF/proxy block —
    // that never reached our Express handlers, so there's no {message}
    // body to read). Falling through to axios's own generic
    // "Request failed with status code N" here isn't useful, so treat it
    // the same as any other unrecognized case: the caller's fallback.
    return fallback;
  }
  // A plain, non-axios Error — e.g. a client-side guard thrown before any
  // request was made (see AuthContext.login's "no admin panel access"
  // check). Its own .message *is* the useful text here, unlike an
  // AxiosError's (also caught by `instanceof Error`, which is why this
  // check must come after the axios branch above, not replace it).
  if (err instanceof Error) return err.message;
  return fallback;
}