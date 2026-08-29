import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, tokenStore, setSessionExpiredHandler, getResponseStatus } from "../utils/api";

export interface AppUser {
  id: string;
  displayName: string;
  email: string;
  role: "user" | "staff" | "admin" | "super_admin";
  status: "active" | "suspended" | "locked";
  emailVerified: boolean;
  profilePicture: string | null;
  identityVerificationStatus: "unverified" | "pending" | "verified" | "rejected";
  notificationsEnabled: boolean;
}

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  register: (displayName: string, email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Prevents loadMe() from clearing user immediately after a successful login
  const [skipLoadMeOnce, setSkipLoadMeOnce] = useState(false);

  const loadMe = useCallback(async () => {
    // If we just logged in, skip the immediate loadMe() call to avoid race condition
    if (skipLoadMeOnce) {
      setSkipLoadMeOnce(false);
      setLoading(false);
      return;
    }

    const token = await tokenStore.getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await api.get("/api/auth/me");
      setUser(res.data.data.user);
    } catch (err) {
      // A confirmed 401/403 means the token really is invalid (rejected,
      // blacklisted, or the account's no longer active) — clear it. But if
      // /me never got a response at all (app opened with no signal yet, a
      // timeout, a flaky connection), the interceptor already tried a
      // silent refresh and left the refresh token alone for exactly this
      // reason — don't undo that here by wiping it anyway. The person
      // still lands on the login screen for this launch, but their stored
      // session survives to restore silently once connectivity is back,
      // instead of forcing a full password re-entry over a signal blip.
      const status = getResponseStatus(err);
      if (status === 401 || status === 403) {
        await tokenStore.clear();
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [skipLoadMeOnce]);

  useEffect(() => {
    loadMe();
    // Wired once so a hard session failure (refresh token also expired)
    // can bounce the app back to the auth flow from anywhere.
    setSessionExpiredHandler(() => setUser(null));
  }, [loadMe]);

  const register = useCallback(async (displayName: string, email: string, password: string) => {
    const res = await api.post("/api/auth/register", { displayName, email, password });
    const { user: newUser, accessToken, refreshToken } = res.data.data;

    // Defensive: require both tokens from the server before committing session
    if (!accessToken || !refreshToken) {
      throw new Error("Authentication response missing tokens.");
    }

    await tokenStore.setTokens(accessToken, refreshToken);
    setUser(newUser);
    // Skip the immediate loadMe() call after registration
    setSkipLoadMeOnce(true);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post("/api/auth/login", { email, password });
    const { user: loggedInUser, accessToken, refreshToken } = res.data.data;

    // Defensive: ensure tokens are present
    if (!accessToken || !refreshToken) {
      throw new Error("Authentication response missing tokens.");
    }

    await tokenStore.setTokens(accessToken, refreshToken);
    setUser(loggedInUser);
    // Skip the immediate loadMe() call after login to avoid race condition
    setSkipLoadMeOnce(true);
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string) => {
    const res = await api.post("/api/auth/google", { idToken, platform: "mobile" });
    const { user: loggedInUser, accessToken, refreshToken } = res.data.data;

    // Defensive: ensure tokens are present
    if (!accessToken || !refreshToken) {
      throw new Error("Authentication response missing tokens.");
    }

    await tokenStore.setTokens(accessToken, refreshToken);
    setUser(loggedInUser);
    // Skip the immediate loadMe() call after Google login to avoid race condition
    setSkipLoadMeOnce(true);
  }, []);

  const logout = useCallback(async () => {
    try {
      const refreshToken = await tokenStore.getRefreshToken();
      await api.post("/api/auth/logout", { refreshToken });
    } catch {
      // Best-effort — clear local state regardless of server outcome.
    }
    await tokenStore.clear();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const res = await api.get("/api/auth/me");
    setUser(res.data.data.user);
  }, []);

  const value = useMemo(
    () => ({ user, loading, register, login, loginWithGoogle, logout, refreshUser }),
    [user, loading, register, login, loginWithGoogle, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
