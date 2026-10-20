import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "../utils/colors";
import { DONATION_IMPACT_LINE, DONATION_MESSAGE } from "../utils/donation";

/** "Ways to help" card: cash/goods actions and an impact line. */
export default function DonationCard() {
  return (
    <View className="mb-2 overflow-hidden rounded-2xl border border-border bg-mintBg">
      <View className="flex-row items-center gap-3 bg-primary p-4">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-white/20">
          <Ionicons name="heart" size={22} color={colors.white} />
        </View>
        <Text className="flex-1 font-sans-medium text-sm text-white">{DONATION_MESSAGE}</Text>
      </View>

      <View className="gap-3 p-3">
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => router.push("/donate")}
            accessibilityRole="button"
            accessibilityLabel="Donate money"
            className="min-h-[48px] flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-primary px-2 active:opacity-80"
          >
            <Ionicons name="cash" size={18} color={colors.white} />
            <Text className="font-sans-bold text-sm text-white" numberOfLines={1}>
              Donate Money
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/donate-goods")}
            accessibilityRole="button"
            accessibilityLabel="Donate goods: food, blankets, medicine"
            className="min-h-[48px] flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-primary bg-white px-2 active:opacity-80"
          >
            <Ionicons name="gift" size={18} color={colors.primary} />
            <Text className="font-sans-bold text-sm text-primary" numberOfLines={1}>
              Donate Goods
            </Text>
          </Pressable>
        </View>
        <Text className="text-center font-sans text-xs text-muted">Goods: food, blankets, medicine</Text>

        <View className="flex-row items-center justify-center gap-1.5">
          <Ionicons name="paw" size={14} color={colors.primary} />
          <Text className="font-sans-medium text-xs text-primary">{DONATION_IMPACT_LINE}</Text>
        </View>
      </View>
    </View>
  );
}
