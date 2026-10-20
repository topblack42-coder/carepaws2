import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useResendVerification } from "../utils/emailVerification";
import colors from "../utils/colors";
import PrimaryButton from "./PrimaryButton";

/** Profile row shown only while the signed-in user's email is unverified. */
export default function EmailVerificationBanner() {
  const { user, refreshUser } = useAuth();
  const { resend, sending, cooldown, feedback } = useResendVerification({ onAlreadyVerified: () => void refreshUser().catch(() => {}) });

  if (!user || user.emailVerified !== false) return null;

  return (
    <View className="mb-6 rounded-2xl border border-status-warning/30 bg-status-warningBg px-4 py-3" testID="email-verification-banner">
      <View className="flex-row items-center gap-2">
        <Ionicons name="mail-unread-outline" size={18} color={colors.status.warning} />
        <Text className="flex-1 font-sans-medium text-sm text-ink">Email not verified</Text>
      </View>
      <Text className="mb-3 mt-1 font-sans text-xs text-slate">Verify your email to apply, enroll in shifts, or volunteer.</Text>
      <PrimaryButton
        variant="outline"
        label={sending ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
        onPress={resend}
        disabled={sending || cooldown > 0}
        testID="resend-verification-button"
      />
      {feedback && (
        <Text className={`mt-2 font-sans text-xs ${feedback.kind === "success" ? "text-mintDeep" : "text-status-danger"}`} testID="resend-verification-feedback">
          {feedback.text}
        </Text>
      )}
    </View>
  );
}
