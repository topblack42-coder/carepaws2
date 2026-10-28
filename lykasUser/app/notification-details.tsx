import { View, Text, ScrollView, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import PrimaryButton from "../components/PrimaryButton";
import { formatDateTime } from "../utils/format";
import { getNotificationMeta, getNotificationRoute } from "../utils/notifications";
import colors from "../utils/colors";

/**
 * Full view of a single notification. The list truncates long messages, so
 * this is where the whole text lives; if the notification points at another
 * screen (application, event, payment...) a button takes the user there.
 */
export default function NotificationDetailsScreen() {
  const params = useLocalSearchParams<{
    title?: string;
    message?: string;
    type?: string;
    refModel?: string;
    refId?: string;
    createdAt?: string;
  }>();

  const meta = getNotificationMeta(params.type || undefined);
  const target = getNotificationRoute({
    type: params.type || undefined,
    refModel: params.refModel || null,
    refId: params.refId || null,
  });
  const created = params.createdAt ? new Date(params.createdAt) : null;
  const hasDate = created !== null && !Number.isNaN(created.getTime());

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-2 px-5 pb-2 pt-2">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <Text className="font-display text-xl text-ink">Notification</Text>
      </View>

      <ScrollView contentContainerClassName="px-5 pb-8 pt-2">
        <View className="rounded-2xl border border-border bg-white p-5">
          <View style={{ backgroundColor: meta.bg }} className="mb-4 h-12 w-12 items-center justify-center rounded-full">
            <Ionicons name={meta.icon} size={24} color={meta.fg} />
          </View>
          <Text className="font-display text-xl text-ink">{params.title}</Text>
          {hasDate && <Text className="mt-1 font-sans text-xs text-mutedLight">{formatDateTime(created as Date)}</Text>}
          <Text className="mt-4 font-sans text-base leading-6 text-ink">{params.message}</Text>
        </View>

        {target && (
          <PrimaryButton label="View details" className="mt-5" onPress={() => router.push(target as never)} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
