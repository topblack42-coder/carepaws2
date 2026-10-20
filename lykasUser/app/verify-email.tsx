import { useEffect, useRef, useState } from "react";
import { View, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../utils/api";
import PrimaryButton from "../components/PrimaryButton";
import { useAuth } from "../context/AuthContext";
import { useResendVerification } from "../utils/emailVerification";
import colors from "../utils/colors";

export default function VerifyEmailScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [message, setMessage] = useState("");
  const { user, refreshUser } = useAuth();
  const { resend, sending, cooldown, feedback } = useResendVerification();
  // Kept in a ref so the verification effect below only depends on the token
  // (the token is single-use; re-running it would turn success into an error).
  const authRef = useRef({ user, refreshUser });
  authRef.current = { user, refreshUser };

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("This verification link is missing its token.");
      return;
    }
    api
      .post("/api/auth/verify-email", { token })
      .then(() => {
        setStatus("success");
        // Pull the now-verified user so the profile banner disappears.
        if (authRef.current.user) authRef.current.refreshUser().catch(() => {});
      })
      .catch((err) => {
        setStatus("error");
        setMessage(getApiErrorMessage(err, "Verification failed"));
      });
  }, [token]);

  return (
    <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-cream px-8">
      {status === "verifying" && <Text className="font-sans text-muted">Verifying your email…</Text>}
      {status === "success" && (
        <>
          <Ionicons name="checkmark-circle" size={40} color={colors.status.success} />
          <Text className="text-center font-display text-xl text-ink">Email verified</Text>
          <PrimaryButton label="Continue" onPress={() => router.replace("/(tabs)")} />
        </>
      )}
      {status === "error" && (
        <>
          <Ionicons name="close-circle" size={40} color={colors.status.danger} />
          <Text className="text-center font-sans text-sm text-ink">{message}</Text>
          {user ? (
            <>
              <PrimaryButton
                label={sending ? "Sending…" : cooldown > 0 ? `Request a new link in ${cooldown}s` : "Request a new link"}
                onPress={resend}
                disabled={sending || cooldown > 0}
                testID="verify-request-new-link"
              />
              {feedback && (
                <Text className={`text-center font-sans text-xs ${feedback.kind === "success" ? "text-mintDeep" : "text-status-danger"}`}>
                  {feedback.text}
                </Text>
              )}
            </>
          ) : (
            <PrimaryButton label="Log in to request a new link" onPress={() => router.replace("/(auth)/logIn")} testID="verify-login-for-new-link" />
          )}
        </>
      )}
    </SafeAreaView>
  );
}
