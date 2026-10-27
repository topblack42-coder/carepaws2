import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "../utils/colors";
import { formatRelativeTime } from "../utils/format";
import { getNotificationMeta, getNotificationRoute, type NotificationItem } from "../utils/notifications";

interface Props {
  notification: NotificationItem;
  /** Total unread, so the banner can say "+2 more". */
  unreadCount: number;
  onDismiss: () => void;
}

/** Newest unread notification, pinned under the header. Tap opens it; X marks it read. */
export default function NotificationBanner({ notification, unreadCount, onDismiss }: Props) {
  const meta = getNotificationMeta(notification.type);
  const more = Math.max(0, unreadCount - 1);

  function open() {
    onDismiss();
    router.push(getNotificationRoute(notification) ?? "/notifications");
  }

  return (
    <View className="mb-4 flex-row items-center rounded-2xl border border-primary/20 bg-mintBg pl-3 pr-1" testID="notification-banner">
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${notification.title}. ${notification.message}`}
        className="flex-1 flex-row items-center gap-3 py-3 active:opacity-70"
      >
        <View style={{ backgroundColor: meta.bg }} className="h-10 w-10 items-center justify-center rounded-full">
          <Ionicons name={meta.icon} size={20} color={meta.fg} />
        </View>
        <View className="flex-1">
          <Text className="font-sans-medium text-sm text-ink" numberOfLines={1}>
            {notification.title}
          </Text>
          <Text className="font-sans text-xs text-muted" numberOfLines={2}>
            {notification.message}
          </Text>
          <Text className="mt-0.5 font-sans text-[11px] text-mutedLight">
            {formatRelativeTime(notification.createdAt)}
            {more > 0 ? `  ·  +${more} more` : ""}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification"
        className="h-11 w-11 items-center justify-center active:opacity-60"
      >
        <Ionicons name="close" size={18} color={colors.muted} />
      </Pressable>
    </View>
  );
}
