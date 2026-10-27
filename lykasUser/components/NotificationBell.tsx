import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "../utils/colors";

/** Bell for screen headers. The badge caps at 99+ and the whole target is 44pt. */
export default function NotificationBell({ count }: { count: number }) {
  const label = count > 99 ? "99+" : String(count);
  return (
    <Pressable
      onPress={() => router.push("/notifications")}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
      hitSlop={6}
      className="h-11 w-11 items-center justify-center rounded-full border border-border bg-white active:opacity-60"
    >
      <Ionicons name={count > 0 ? "notifications" : "notifications-outline"} size={22} color={colors.ink} />
      {count > 0 && (
        <View
          testID="notification-badge"
          className="absolute -right-0.5 -top-0.5 h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-cream bg-accentOrange px-1"
        >
          <Text className="font-sans-bold text-[10px] leading-[12px] text-white">{label}</Text>
        </View>
      )}
    </Pressable>
  );
}
