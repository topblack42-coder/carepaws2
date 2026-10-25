import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL, api, tokenStore } from "../services/api";
import { useAuth } from "./AuthContext";

/** Payload of the server's "data:changed" event (see lykasServer/src/utils/realtime.js). */
export interface RealtimeEvent {
  resource: string;
  action: string;
  ids?: string[];
  at: number;
}

/** `null` means "you may have missed events" (initial connect / reconnect) — refetch. */
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
 * One shared Socket.IO connection for the whole admin panel. Pages never
 * touch the socket directly — they call useRealtime(resources, refetch) and
 * the server's change feed tells them when something they show has changed.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? (user as { _id?: string } | null)?._id ?? null;
  const [connected, setConnected] = useState(false);
  const subscribers = useRef(new Set<Subscriber>());

  useEffect(() => {
    if (!userId) return;

    let hasConnectedBefore = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // `auth` as a function is re-evaluated on every (re)connect, so a token
    // refreshed by the axios interceptor is picked up automatically.
    const socket: Socket = io(API_URL, {
      auth: (cb) => cb({ token: tokenStore.getAccessToken() }),
    });

    const notifyAll = () => subscribers.current.forEach((s) => s.handler(null));

    socket.on("connect", () => {
      setConnected(true);
      // Catch up on anything missed while offline (not on the very first
      // connect — pages have just loaded their own data).
      if (hasConnectedBefore) notifyAll();
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
      subscribers.current.forEach((s) => {
        if (s.resources.has(event.resource)) s.handler(event);
      });
    });

    const onVisible = () => {
      if (document.visibilityState === "visible" && !socket.connected) socket.connect();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
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

/** Whether the live connection is currently up (false outside the provider). */
export function useRealtimeStatus(): boolean {
  return useContext(RealtimeContext)?.connected ?? false;
}

/**
 * Calls `handler` whenever one of `resources` (Mongoose model names, e.g.
 * "Application") changes on the server, and after a reconnect. The handler
 * should refetch quietly — no spinner, no error banner. Safe to use with no
 * provider mounted (it simply does nothing, e.g. in unit tests).
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
    // `ctx.subscribe` is recreated when connection state flips; resubscribing is cheap.
  }, [ctx, key]);
}
