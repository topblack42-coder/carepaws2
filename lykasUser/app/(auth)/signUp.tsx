// app/(auth)/signUp.tsx
import { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../utils/api";
import PrimaryButton from "../../components/PrimaryButton";
import FormInput from "../../components/FormInput";
import colors from "../../utils/colors";

export default function SignUpScreen() {
  const { register, loginWithGoogle, markJustRegistered } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleSignUp() {
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      await register(displayName, email, password);
      // No router.replace here: register() sets justRegistered, and the
      // root layout's navigation guard (app/_layout.tsx) is the single
      // place that now decides where a freshly-authenticated user goes —
      // see routeGuard.ts for why a second, competing replace() here used
      // to race that guard and sometimes skip onboarding entirely.
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't create your account"));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignUp() {
    setError(null);
    setGoogleLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const result = await GoogleSignin.signIn();
      const idToken = result.data?.idToken;
      if (!idToken) throw new Error("Google sign-in didn't return a token");
      // loginWithGoogle() is shared with the login screen, so it can't set
      // justRegistered itself — mark it here, from the screen that knows
      // this call means "sign up," before the shared context method runs.
      markJustRegistered();
      await loginWithGoogle(idToken);
      // No router.replace here — see the comment in handleSignUp above.
    } catch (err) {
      setError(getApiErrorMessage(err, "Google sign-in failed"));
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-10" keyboardShouldPersistTaps="handled">
        <View className="mb-8 items-center gap-2">
          <Ionicons name="paw" size={40} color={colors.primary} />
          <Text className="font-display text-2xl text-ink">Join CarePaws</Text>
          <Text className="font-sans text-sm text-muted">Create an account to start your adoption journey</Text>
        </View>

        {error && (
          <View className="mb-4 rounded-xl border border-status-danger/20 bg-status-dangerBg px-4 py-3">
            <Text className="font-sans text-sm text-status-danger">{error}</Text>
          </View>
        )}

        <FormInput label="Full name" value={displayName} onChangeText={setDisplayName} testID="signup-name" />
        <FormInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" testID="signup-email" />
        <FormInput label="Password" value={password} onChangeText={setPassword} isPassword testID="signup-password" />
        <FormInput label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} isPassword testID="signup-confirm" />

        <PrimaryButton label="Create account" onPress={handleSignUp} loading={loading} className="mt-2" testID="signup-submit" />

        <View className="my-5 flex-row items-center gap-3">
          <View className="h-px flex-1 bg-border" />
          <Text className="font-sans text-xs text-mutedLight">or</Text>
          <View className="h-px flex-1 bg-border" />
        </View>

        <PrimaryButton label="Continue with Google" variant="secondary" onPress={handleGoogleSignUp} loading={googleLoading} />

        <View className="mt-8 flex-row justify-center gap-1">
          <Text className="font-sans text-sm text-muted">Already have an account?</Text>
          <Link href="/logIn" asChild>
            <Pressable accessibilityRole="button">
              <Text className="font-sans-medium text-sm text-primary">Sign in</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}