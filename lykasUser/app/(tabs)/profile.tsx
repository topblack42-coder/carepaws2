import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import colors from "../../utils/colors";
import StatusBadge from "../../components/StatusBadge";
import EmailVerificationBanner from "../../components/EmailVerificationBanner";

interface MenuItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

function MenuItem({ icon, label, onPress }: MenuItemProps) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 border-b border-border/60 py-3.5" accessibilityRole="button">
      <Ionicons name={icon} size={20} color={colors.slate} />
      <Text className="flex-1 font-sans text-base text-ink">{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.mutedLight} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { user, logout } = useAuth();

  function confirmLogout() {
    Alert.alert("Log out?", "You'll need to sign in again to continue.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/(auth)/logIn");
        },
      },
    ]);
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView contentContainerClassName="px-5 pb-8 pt-2">
        <View className="mb-6 flex-row items-center gap-4">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-mintBg">
            <Text className="font-display text-xl text-primary">{user?.displayName?.[0]?.toUpperCase()}</Text>
          </View>
          <View className="flex-1">
            <Text className="font-display text-lg text-ink" numberOfLines={1}>
              {user?.displayName}
            </Text>
            <Text className="font-sans text-sm text-muted" numberOfLines={1}>
              {user?.email}
            </Text>
            <View className="mt-1 flex-row">
              <StatusBadge status={user?.identityVerificationStatus ?? "unverified"} />
            </View>
          </View>
        </View>

        <EmailVerificationBanner />

        <View className="mb-6 rounded-2xl border border-border bg-white px-4">
          <MenuItem icon="document-text-outline" label="My Applications" onPress={() => router.push("/(tabs)/my-applications")} />
          <MenuItem icon="paw-outline" label="My Pets" onPress={() => router.push("/my-pets")} />
          <MenuItem icon="calendar-outline" label="My Appointments" onPress={() => router.push("/my-appointments")} />
          <MenuItem icon="heart-outline" label="Foster Dashboard" onPress={() => router.push("/foster-dashboard")} />
          <MenuItem icon="wallet-outline" label="Payment History" onPress={() => router.push("/payments")} />
          <MenuItem icon="document-attach-outline" label="Documents" onPress={() => router.push("/documents")} />
        </View>

        <View className="mb-6 rounded-2xl border border-border bg-white px-4">
          <MenuItem icon="hand-left-outline" label="Volunteer" onPress={() => router.push("/volunteer-portal")} />
          <MenuItem icon="gift-outline" label="Donate" onPress={() => router.push("/donate")} />
          <MenuItem icon="cube-outline" label="Donate Goods" onPress={() => router.push("/donate-goods")} />
          <MenuItem icon="star-outline" label="Feedback" onPress={() => router.push("/feedback")} />
        </View>

        <View className="mb-6 rounded-2xl border border-border bg-white px-4">
          <MenuItem icon="notifications-outline" label="Notifications" onPress={() => router.push("/notifications")} />
          <MenuItem icon="settings-outline" label="Settings" onPress={() => router.push("/(tabs)/settings")} />
          <MenuItem icon="warning-outline" label="Report an Emergency" onPress={() => router.push("/emergency-report")} />
          <MenuItem icon="help-circle-outline" label="Help & Support" onPress={() => router.push("/help")} />
        </View>

        <Pressable onPress={confirmLogout} className="items-center rounded-2xl border border-status-danger/20 bg-status-dangerBg py-3.5">
          <Text className="font-sans-medium text-sm text-status-danger">Log out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
