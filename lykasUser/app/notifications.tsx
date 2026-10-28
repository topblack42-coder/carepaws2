import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtimeReload, useSilentFlag } from "../context/RealtimeContext";
import { View, Text, SectionList, Pressable, RefreshControl, Alert } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../utils/api";
import { formatRelativeTime } from "../utils/format";
import { getNotificationMeta, type NotificationItem } from "../utils/notifications";
import StateView from "../components/StateView";
import colors from "../utils/colors";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");

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

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const sections = useMemo(() => {
    const visible = filter === "unread" ? notifications.filter((n) => !n.isRead) : notifications;
    const today = startOfToday();
    const recent = visible.filter((n) => new Date(n.createdAt).getTime() >= today);
    const earlier = visible.filter((n) => new Date(n.createdAt).getTime() < today);
    return [
      { title: "Today", data: recent },
      { title: "Earlier", data: earlier },
    ].filter((s) => s.data.length > 0);
  }, [notifications, filter]);

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)));
    try {
      await api.put(`/api/notifications/${id}/read`);
    } catch {
      // Non-fatal — the read state will just re-sync on next load.
    }
  }

  function openNotification(n: NotificationItem) {
    if (!n.isRead) void markRead(n._id);
    // Open the detail page, which shows the full message and links on to the related screen.
    router.push({
      pathname: "/notification-details",
      params: {
        title: n.title,
        message: n.message,
        type: n.type ?? "",
        refModel: n.refModel ?? "",
        refId: n.refId ?? "",
        createdAt: n.createdAt,
      },
    });
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await api.put("/api/notifications/read-all");
    } catch {
      load();
    }
  }

  function removeOne(id: string) {
    const previous = notifications;
    setNotifications((prev) => prev.filter((n) => n._id !== id));
    api.delete(`/api/notifications/${id}`).catch(() => setNotifications(previous));
  }

  function confirmClearAll() {
    Alert.alert("Clear all notifications?", "This removes every notification from your list.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear all",
        style: "destructive",
        onPress: async () => {
          const previous = notifications;
          setNotifications([]);
          try {
            await api.delete("/api/notifications");
          } catch {
            setNotifications(previous);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="flex-row items-center justify-between px-5 pb-2 pt-2">
        <View className="flex-row items-center gap-2">
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
          <Text className="font-display text-xl text-ink">Notifications</Text>
        </View>
        {notifications.length > 0 && (
          <Pressable onPress={confirmClearAll} accessibilityRole="button" accessibilityLabel="Clear all notifications" className="p-2">
            <Ionicons name="trash-outline" size={20} color={colors.muted} />
          </Pressable>
        )}
      </View>

      {notifications.length > 0 && (
        <View className="flex-row items-center justify-between px-5 pb-3">
          <View className="flex-row gap-2">
            {(["all", "unread"] as const).map((f) => (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === f }}
                className={`rounded-full border px-4 py-1.5 ${filter === f ? "border-primary bg-primary" : "border-border bg-white"}`}
              >
                <Text className={`font-sans-medium text-sm ${filter === f ? "text-white" : "text-ink"}`}>
                  {f === "all" ? "All" : `Unread${unreadCount ? ` (${unreadCount})` : ""}`}
                </Text>
              </Pressable>
            ))}
          </View>
          {unreadCount > 0 && (
            <Pressable onPress={markAllRead} accessibilityRole="button" className="py-1.5 pl-2">
              <Text className="font-sans-medium text-sm text-primary">Mark all read</Text>
            </Pressable>
          )}
        </View>
      )}

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={load} />
      ) : notifications.length === 0 ? (
        <StateView state="empty" title="No notifications" message="You're all caught up." />
      ) : sections.length === 0 ? (
        <StateView state="empty" title="Nothing unread" message="You've read everything. Nice." />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => n._id}
          stickySectionHeadersEnabled={false}
          contentContainerClassName="px-5 pb-8"
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
          renderSectionHeader={({ section }) => (
            <Text className="mb-2 mt-3 font-sans-medium text-xs uppercase tracking-wider text-muted">{section.title}</Text>
          )}
          ItemSeparatorComponent={() => <View className="h-2" />}
          renderItem={({ item }) => {
            const meta = getNotificationMeta(item.type);
            return (
              <Pressable
                onPress={() => openNotification(item)}
                onLongPress={() => removeOne(item._id)}
                accessibilityRole="button"
                accessibilityLabel={`${item.isRead ? "" : "Unread. "}${item.title}. ${item.message}`}
                accessibilityHint="Long press to delete"
                className={`flex-row items-start gap-3 rounded-2xl border px-3 py-3 active:opacity-70 ${item.isRead ? "border-border bg-white" : "border-primary/30 bg-mintBg"}`}
              >
                <View style={{ backgroundColor: meta.bg }} className="h-10 w-10 items-center justify-center rounded-full">
                  <Ionicons name={meta.icon} size={20} color={meta.fg} />
                </View>
                <View className="flex-1">
                  <View className="flex-row items-start justify-between gap-2">
                    <Text numberOfLines={1} ellipsizeMode="tail" className={`flex-1 text-sm text-ink ${item.isRead ? "font-sans" : "font-sans-bold"}`}>{item.title}</Text>
                    {!item.isRead && <View className="mt-1.5 h-2 w-2 rounded-full bg-accentOrange" />}
                  </View>
                  <Text numberOfLines={1} ellipsizeMode="tail" className="mt-0.5 font-sans text-xs leading-4 text-muted">{item.message}</Text>
                  <Text className="mt-1 font-sans text-[11px] text-mutedLight">{formatRelativeTime(item.createdAt)}</Text>
                </View>
              </Pressable>
            );
          }}
          ListFooterComponent={<Text className="mt-4 text-center font-sans text-xs text-mutedLight">Long-press a notification to delete it</Text>}
        />
      )}
    </SafeAreaView>
  );
}
