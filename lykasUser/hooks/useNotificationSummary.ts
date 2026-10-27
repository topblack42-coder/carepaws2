import { useCallback, useEffect, useState } from "react";
import { useRealtime } from "../context/RealtimeContext";
import { api } from "../utils/api";
import type { NotificationItem } from "../utils/notifications";

/**
 * Unread count + the newest unread notification, kept live through the
 * realtime feed. Failures are silent: a broken bell must never break a screen.
 */
export function useNotificationSummary() {
  const [count, setCount] = useState(0);
  const [latest, setLatest] = useState<NotificationItem | null>(null);

  const load = useCallback(async () => {
    try {
      const [countRes, listRes] = await Promise.all([api.get("/api/notifications/unread-count"), api.get("/api/notifications/my")]);
      setCount(countRes.data.data.count ?? 0);
      const items: NotificationItem[] = listRes.data.data ?? [];
      setLatest(items.find((n) => !n.isRead) ?? null);
    } catch {
      /* keep whatever we last knew */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRealtime(["Notification"], () => {
    void load();
  });

  /** Hide the banner right away without waiting for the server round-trip. */
  const dismissLatest = useCallback(async () => {
    const target = latest;
    if (!target) return;
    setLatest(null);
    setCount((c) => Math.max(0, c - 1));
    try {
      await api.put(`/api/notifications/${target._id}/read`);
    } catch {
      void load();
    }
    void load();
  }, [latest, load]);

  return { count, latest, reload: load, dismissLatest };
}
