import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { io, type Socket } from "socket.io-client";
import { API_URL, api, tokenStore } from "../utils/api";
import { useAuth } from "./AuthContext";

/** Payload of the server's "data:changed" event (see lykasServer/src/utils/realtime.js). */
export interface RealtimeEvent {
  resource: string;
  action: string;
  ids?: string[];
  at: number;
}

/** `null` means "you may have missed events" (reconnect / back to foreground) — refetch. */
type Handler = (event: RealtimeEvent | null) => void;

interface Subscriber {
  resources: ReadonlySet<string>;
  handler: Handler;
}

interface RealtimeContextValue {
  connected: boolean;
  subscribe: (resources: readonly string[], handler: Handler) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | undefined>(undefined);

const RECONNECT_AFTER_DENIED_MS = 5000;

/**
 * One shared Socket.IO connection for the whole app. Screens call
 * useRealtimeReload(resources, load, flag) and the server's change feed tells
 * them when something they display has changed. The chat tab keeps its own
 * dedicated socket for messages.
 *
 * Mount inside <AuthProvider>.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth();
  const userId = user?.id ?? null;
  const [connected, setConnected] = useState(false);
  const subscribers = useRef(new Set<Subscriber>());
  const refreshUserRef = useRef(refreshUser);
  useEffect(() => {
    refreshUserRef.current = refreshUser;
  });

  useEffect(() => {
    if (!userId) return;

    let hasConnectedBefore = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // `auth` as a function is re-evaluated on every (re)connect, so a token
    // refreshed by the axios interceptor is picked up automatically.
    const socket: Socket = io(API_URL, {
      auth: (cb) => {
        tokenStore
          .getAccessToken()
          .then((token) => cb({ token }))
          .catch(() => cb({ token: null }));
      },
    });

    const notifyAll = () => subscribers.current.forEach((s) => s.handler(null));

    socket.on("connect", () => {
      setConnected(true);
      if (hasConnectedBefore) notifyAll(); // catch up on whatever we missed
      hasConnectedBefore = true;
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => {
      setConnected(false);
      // A handshake rejected by the server (expired token) is not retried
      // by Socket.IO. Refresh the session via the API, then reconnect.
      if (!socket.active) {
        retryTimer = setTimeout(async () => {
          try {
            await api.get("/api/auth/me");
            socket.connect();
          } catch {
            /* session is gone — AuthContext will sign the user out */
          }
        }, RECONNECT_AFTER_DENIED_MS);
      }
    });

    socket.on("data:changed", (event: RealtimeEvent) => {
      // The signed-in user's own account changed (e.g. identity verified by
      // staff): refresh it so the profile updates without a restart.
      if (event.resource === "User") refreshUserRef.current().catch(() => {});
      subscribers.current.forEach((s) => {
        if (s.resources.has(event.resource)) s.handler(event);
      });
    });

    // iOS/Android suspend sockets in the background, so changes can be
    // missed without a disconnect being noticed. Catch up on foreground.
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (socket.connected) notifyAll();
      else socket.connect(); // the connect handler above does the catch-up
    });

    return () => {
      appState.remove();
      if (retryTimer) clearTimeout(retryTimer);
      socket.disconnect();
      setConnected(false);
    };
  }, [userId]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      connected,
      subscribe: (resources, handler) => {
        const subscriber: Subscriber = { resources: new Set(resources), handler };
        subscribers.current.add(subscriber);
        return () => {
          subscribers.current.delete(subscriber);
        };
      },
    }),
    [connected]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/**
 * Calls `handler` whenever one of `resources` (Mongoose model names, e.g.
 * "Application") changes on the server, and after a reconnect. Safe to use
 * with no provider mounted (it does nothing — e.g. in unit tests).
 */
export function useRealtime(resources: readonly string[], handler: Handler): void {
  const ctx = useContext(RealtimeContext);
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const key = resources.join("|");
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(key ? key.split("|") : [], (event) => handlerRef.current(event));
  }, [ctx, key]);
}

/**
 * Lets a screen's existing load() know that a call is a live refresh:
 *
 *   const live = useSilentFlag();
 *   const load = useCallback(async () => {
 *     const silent = live.take();
 *     if (!silent) { setLoading(true); setError(null); }
 *     ...
 *   }, [live]);
 *   useRealtimeReload(["Pet"], load, live);
 *
 * A silent load keeps the current content on screen: no spinner, and a
 * failed refetch doesn't replace it with an error. load() keeps its normal
 * signature, so `onRetry={load}` and friends are unaffected.
 */
export function useSilentFlag() {
  const ref = useRef(false);
  return useMemo(
    () => ({
      mark: () => {
        ref.current = true;
      },
      take: () => {
        const value = ref.current;
        ref.current = false;
        return value;
      },
    }),
    []
  );
}

/** Re-run `load` quietly whenever one of `resources` changes. */
export function useRealtimeReload(
  resources: readonly string[],
  load: () => unknown,
  flag: ReturnType<typeof useSilentFlag>
): void {
  useRealtime(resources, () => {
    flag.mark();
    void load();
  });
}
