import { Pressable, View, Text } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import colors from "../utils/colors";
import { titleCase } from "../utils/format";
import { getStageProgress, type ApplicationSummary } from "../utils/applications";
import StatusBadge from "./StatusBadge";

/** Compact application card for the Home carousel. */
export default function ApplicationCard({ application, onPress }: { application: ApplicationSummary; onPress: () => void }) {
  const { pet, type, status, stage } = application;
  const progress = getStageProgress(stage);
  const typeLabel = titleCase(type);

  return (
    <Pressable
      onPress={onPress}
      className="w-full rounded-2xl border border-border bg-white p-3 active:opacity-80"
      accessibilityRole="button"
      accessibilityLabel={`${pet?.name ?? "Pet"} ${typeLabel} application, ${status.replace(/_/g, " ")}, currently ${titleCase(stage)}`}
    >
      <View className="flex-row items-center gap-3">
        <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-cardBg">
          {pet?.imageUrl ? (
            <Image source={{ uri: pet.imageUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
          ) : (
            <Ionicons name="paw" size={22} color={colors.sand} />
          )}
        </View>
        <View className="flex-1 gap-1">
          <Text className="font-display text-base text-ink" numberOfLines={1}>
            {pet?.name}
          </Text>
          <View className="flex-row items-center gap-2">
            <Text className="font-sans text-xs text-muted">{typeLabel}</Text>
            <StatusBadge status={status} />
          </View>
        </View>
      </View>

      <View className="mt-3 flex-row items-center gap-1.5">
        <Ionicons name="document-text" size={14} color={colors.primary} />
        <Text className="flex-1 font-sans text-xs text-ink" numberOfLines={1}>
          {titleCase(stage)}
        </Text>
        {progress && (
          <Text className="font-sans-medium text-xs text-muted">
            Step {progress.step} of {progress.total}
          </Text>
        )}
      </View>

      {progress && (
        <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-mintBg" testID="application-progress">
          <View className="h-full rounded-full bg-primary" style={{ width: `${(progress.step / progress.total) * 100}%` }} />
        </View>
      )}
    </Pressable>
  );
}
