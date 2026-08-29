import { useEffect, useCallback, Component, type ReactNode } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { View, Text, ActivityIndicator } from "react-native";
import { useFonts, Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { AuthProvider, useAuth } from "../context/AuthContext";
import PrimaryButton from "../components/PrimaryButton";
import colors from "../utils/colors";
import { getRedirectTarget } from "../utils/routeGuard";
import "../global.css";

SplashScreen.preventAutoHideAsync();

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * A minimal class-based error boundary wrapping the root layout, so a
 * single screen crash doesn't white-screen the whole app (§3's mobile
 * production addition). React error boundaries must be class
 * components — there is no hook equivalent.
 */
class RootErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("Uncaught error in app tree:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View className="flex-1 items-center justify-center gap-4 bg-cream px-8">
          <Text className="text-center font-display text-xl text-ink">Something went wrong</Text>
          <Text className="text-center font-sans text-sm text-muted">
            Please restart the app. If this keeps happening, contact support from the Help screen.
          </Text>
          <PrimaryButton label="Try again" onPress={() => this.setState({ hasError: false })} />
        </View>
      );
    }
    return this.props.children;
  }
}

/**
 * Centralizes protected-navigation enforcement in one place. Previously
 * only (tabs)/_layout.tsx guarded anything (redirecting to login when
 * `!user`), which covers the tab bar screens but not the ~20 other
 * top-level routes (my-pets, payments, donate, foster-dashboard,
 * documents, application-details/[id], baby-book/[petId], ...) — a direct
 * deep link to any of those while logged out bypassed every guard and
 * rendered the screen shell before its API calls came back 401. This runs
 * on every segment change and also sends an already-authenticated user
 * out of the (auth) screens rather than leaving them sitting on the login
 * form. The actual decision lives in utils/routeGuard.ts so it's unit
 * tested on its own — see __tests__/route-guard.test.ts.
 */
function RootNavigation() {
  const { user, loading, justRegistered, clearJustRegistered } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const target = getRedirectTarget({ isAuthenticated: !!user, loading, segments, justRegistered });
    if (target) {
      router.replace(target);
      // One-shot: this flag's only job is steering this specific redirect
      // toward /onboarding instead of /(tabs). Clear it immediately so it
      // can't affect any later navigation for the rest of the session.
      if (target === "/onboarding") clearJustRegistered();
    }
  }, [user, loading, segments, justRegistered, clearJustRegistered, router]);

  // Hold every screen — including public ones — behind the splash-style
  // spinner until session restoration resolves, matching the spinner
  // (tabs)/_layout.tsx already shows for its own slice of this same
  // window, so nothing (protected or not) can mount and fire off API
  // calls before we know whether there's a signed-in user.
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    onLayoutRootView();
  }, [onLayoutRootView]);

  if (!fontsLoaded && !fontError) {
    // Splash screen is still showing — render nothing underneath it.
    return null;
  }

  return (
    <RootErrorBoundary>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigation />
      </AuthProvider>
    </RootErrorBoundary>
  );
}
