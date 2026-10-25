import { useCallback, useEffect, useState } from "react";
import { useRealtimeReload, useSilentFlag } from "../context/RealtimeContext";
import { View, Text, FlatList, Pressable, RefreshControl } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../utils/api";
import { formatRelativeTime } from "../utils/format";
import StateView from "../components/StateView";
import colors from "../utils/colors";

interface NotificationItem {
  _id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const live = useSilentFlag();

  const load = useCallback(async () => {
    const silent = live.take();
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await api.get("/api/notifications/my");
      setNotifications(res.data.data);
    } catch (err) {
      if (!silent) setError(getApiErrorMessage(err, "Failed to load notifications"));
    } finally {
      setLoading(false);
    }
  }, [live]);

  useRealtimeReload(["Notification"], load, live);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)));
    try {
      await api.put(`/api/notifications/${id}/read`);
    } catch {
      // Non-fatal — the read state will just re-sync on next load.
    }
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await api.put("/api/notifications/read-all");
    } catch {
      load();
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
        <View className="flex-row items-center gap-2">
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
          <Text className="font-display text-xl text-ink">Notifications</Text>
        </View>
        {notifications.some((n) => !n.isRead) && (
          <Pressable onPress={markAllRead} accessibilityRole="button">
            <Text className="font-sans-medium text-sm text-primary">Mark all read</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={load} />
      ) : notifications.length === 0 ? (
        <StateView state="empty" title="No notifications" message="You're all caught up." />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n._id}
          contentContainerClassName="px-5 pb-8 gap-2"
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => markRead(item._id)}
              className={`flex-row gap-3 rounded-xl border px-4 py-3 ${item.isRead ? "border-border bg-white" : "border-primary/30 bg-mintBg"}`}
            >
              {!item.isRead && <View className="mt-1.5 h-2 w-2 rounded-full bg-primary" />}
              <View className="flex-1">
                <Text className="font-sans-medium text-sm text-ink">{item.title}</Text>
                <Text className="mt-0.5 font-sans text-xs text-muted">{item.message}</Text>
                <Text className="mt-1 font-sans text-xs text-mutedLight">{formatRelativeTime(item.createdAt)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
