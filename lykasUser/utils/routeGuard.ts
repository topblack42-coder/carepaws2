/**
 * Routes reachable without a signed-in user. Everything else — every
 * top-level screen (my-pets, payments, donate, foster-dashboard,
 * documents, notifications, application-details/[id], baby-book/[petId],
 * ...) plus the whole (tabs) group — requires one, because every
 * "my"/user-scoped endpoint those screens call is itself `protect`ed
 * server-side (confirmed against the route files: there is no anonymous
 * path anywhere in this app once you're past these). "onboarding" is
 * static marketing content with no API calls, so there's no harm in it
 * being reachable pre-auth too.
 */
export const PUBLIC_ROUTES = new Set(["onboarding", "forgot-password", "reset-password", "verify-email", "help", "+not-found"]);

/**
 * Pure decision function for the root navigation guard: given the current
 * auth state and route segments, where (if anywhere) should we redirect?
 * Returns null when the current screen is already the right place to be.
 *
 * Kept side-effect-free and independent of expo-router/React so the
 * decision itself can be unit tested directly (see
 * __tests__/route-guard.test.ts) instead of only through a rendered
 * component tree — this is the logic that closes the "deep link to a
 * protected screen while logged out" gap, so it's worth exercising on its
 * own rather than trusting it by inspection alone.
 */
export function getRedirectTarget(params: {
  isAuthenticated: boolean;
  loading: boolean;
  segments: readonly string[];
  // True for exactly one redirect: the one immediately after a successful
  // sign-up (email or Google). Previously signUp.tsx issued its own
  // router.replace("/onboarding") right after register()/loginWithGoogle(),
  // which raced this same effect's "authenticated user still in (auth) ->
  // send to tabs" rule below — whichever replace() landed second silently
  // won, so new users sometimes skipped onboarding entirely. Routing that
  // decision through this single function instead removes the race by
  // construction: there is now exactly one place that decides where a
  // freshly-authenticated user goes.
  justRegistered?: boolean;
}): string | null {
  const { isAuthenticated, loading, segments, justRegistered = false } = params;
  if (loading || segments.length === 0) return null;

  const inAuthGroup = segments[0] === "(auth)";
  const isPublicRoute = inAuthGroup || PUBLIC_ROUTES.has(segments[0]);

  if (!isAuthenticated && !isPublicRoute) return "/(auth)/logIn";
  if (isAuthenticated && inAuthGroup) return justRegistered ? "/onboarding" : "/(tabs)";
  return null;
}
