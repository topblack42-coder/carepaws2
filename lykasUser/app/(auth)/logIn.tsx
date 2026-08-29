// app/(auth)/logIn.tsx
import { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Link, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage, tokenStore } from "../../utils/api";
import PrimaryButton from "../../components/PrimaryButton";
import FormInput from "../../components/FormInput";
import colors from "../../utils/colors";

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_IOS_CLIENT_ID,
});

export default function LogInScreen() {
  const { login, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      await login(email, password);

      // Defensive: ensure the refresh token was persisted before navigating.
      const rt = await tokenStore.getRefreshToken();
      if (!rt) throw new Error("Session could not be established. Please try again.");

      router.replace("/(tabs)");
    } catch (err) {
      setError(err instanceof Error ? err.message : getApiErrorMessage(err, "Couldn't log you in — check your email and password."));
    } finally {
      setLoading(false);
    }
  }

  // Native Google Sign-In SDK — exchanges tokens without a browser
  // redirect at all, sidestepping the whole redirect-URI class of bugs
  // that expo-auth-session would introduce here (§4, §9).
  async function handleGoogleLogin() {
    setError(null);
    setGoogleLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const result = await GoogleSignin.signIn();
      const idToken = result.data?.idToken;
      if (!idToken) throw new Error("Google sign-in didn't return a token");
      await loginWithGoogle(idToken);

      const rt = await tokenStore.getRefreshToken();
      if (!rt) throw new Error("Session could not be established. Please try again.");

      router.replace("/(tabs)");
    } catch (err) {
      setError(getApiErrorMessage(err, "Google sign-in failed"));
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-10" keyboardShouldPersistTaps="handled">
        <View className="mb-10 items-center gap-2">
          <Ionicons name="paw" size={40} color={colors.primary} />
          <Text className="font-display text-2xl text-ink">Welcome back</Text>
          <Text className="font-sans text-sm text-muted">Sign in to continue helping pets find homes</Text>
        </View>

        {error && (
          <View className="mb-4 rounded-xl border border-status-danger/20 bg-status-dangerBg px-4 py-3">
            <Text className="font-sans text-sm text-status-danger">{error}</Text>
          </View>
        )}

        <FormInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" testID="login-email" />
        <FormInput label="Password" value={password} onChangeText={setPassword} isPassword testID="login-password" />

        <Link href="/forgot-password" asChild>
          <Pressable accessibilityRole="button">
            <Text className="mb-4 mt-2 text-right font-sans text-sm text-primary">Forgot your password?</Text>
          </Pressable>
        </Link>

        <PrimaryButton label="Sign in" onPress={handleLogin} loading={loading} className="mt-2" testID="login-submit" />

        <View className="my-5 flex-row items-center gap-3">
          <View className="h-px flex-1 bg-border" />
          <Text className="font-sans text-xs text-mutedLight">or</Text>
          <View className="h-px flex-1 bg-border" />
        </View>

        <PrimaryButton label="Continue with Google" variant="secondary" onPress={handleGoogleLogin} loading={googleLoading} />

        <View className="mt-8 flex-row justify-center gap-1">
          <Text className="font-sans text-sm text-muted">New here?</Text>
          <Link href="/signUp" asChild>
            <Pressable accessibilityRole="button">
              <Text className="font-sans-medium text-sm text-primary">Create an account</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
