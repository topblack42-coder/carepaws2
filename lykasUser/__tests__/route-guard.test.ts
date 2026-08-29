import { getRedirectTarget } from "../utils/routeGuard";

/**
 * Covers the fix for the "protected navigation" gap: (tabs)/_layout.tsx
 * guarded the tab bar screens, but the ~20 other top-level routes
 * (my-pets, payments, donate, application-details/[id], baby-book/[petId],
 * ...) had no guard at all and were reachable via direct deep link while
 * logged out. getRedirectTarget is the pure decision behind the
 * centralized guard in app/_layout.tsx that closes that gap — tested
 * directly here since it has no React/expo-router dependency.
 */
describe("getRedirectTarget", () => {
  it("does nothing while auth state is still loading", () => {
    expect(getRedirectTarget({ isAuthenticated: false, loading: true, segments: ["my-pets"] })).toBeNull();
    expect(getRedirectTarget({ isAuthenticated: true, loading: true, segments: ["(auth)", "logIn"] })).toBeNull();
  });

  it("does nothing before segments have resolved", () => {
    expect(getRedirectTarget({ isAuthenticated: false, loading: false, segments: [] })).toBeNull();
  });

  it("sends a logged-out user on a previously-unguarded protected screen to login", () => {
    for (const segments of [
      ["my-pets"],
      ["payments"],
      ["donate"],
      ["foster-dashboard"],
      ["documents"],
      ["notifications"],
      ["volunteer-portal"],
      ["application-details", "abc123"],
      ["baby-book", "petid123"],
      ["appointments"],
      ["appointments", "apply", "5"],
      ["payment", "success"],
    ]) {
      expect(getRedirectTarget({ isAuthenticated: false, loading: false, segments })).toBe("/(auth)/logIn");
    }
  });

  it("sends a logged-out user in the (tabs) group to login", () => {
    expect(getRedirectTarget({ isAuthenticated: false, loading: false, segments: ["(tabs)"] })).toBe("/(auth)/logIn");
    expect(getRedirectTarget({ isAuthenticated: false, loading: false, segments: ["(tabs)", "adopt"] })).toBe("/(auth)/logIn");
  });

  it("leaves a logged-out user alone on public routes", () => {
    for (const seg of ["onboarding", "forgot-password", "reset-password", "verify-email", "help"]) {
      expect(getRedirectTarget({ isAuthenticated: false, loading: false, segments: [seg] })).toBeNull();
    }
  });

  it("leaves a logged-out user alone on the (auth) screens", () => {
    expect(getRedirectTarget({ isAuthenticated: false, loading: false, segments: ["(auth)", "logIn"] })).toBeNull();
    expect(getRedirectTarget({ isAuthenticated: false, loading: false, segments: ["(auth)", "signUp"] })).toBeNull();
  });

  it("sends an already-authenticated user out of the (auth) screens instead of leaving them on the login form", () => {
    expect(getRedirectTarget({ isAuthenticated: true, loading: false, segments: ["(auth)", "logIn"] })).toBe("/(tabs)");
    // Plain login (justRegistered omitted/false) still goes straight to tabs —
    // only a fresh sign-up should detour through onboarding.
    expect(getRedirectTarget({ isAuthenticated: true, loading: false, segments: ["(auth)", "signUp"] })).toBe("/(tabs)");
  });

  /**
   * Regression coverage for the "new users skip onboarding" bug:
   * signUp.tsx used to issue its own router.replace("/onboarding") right
   * after register(), which raced this exact guard — since both fire off
   * the same "user just became authenticated" state change, whichever
   * replace() landed second silently won, so sign-up sometimes dropped
   * straight into (tabs) instead of onboarding. Routing the decision
   * through getRedirectTarget itself (via justRegistered) removes the race
   * by construction: there is only one function deciding the destination.
   */
  it("sends a freshly-registered user to onboarding instead of straight to tabs", () => {
    expect(
      getRedirectTarget({ isAuthenticated: true, loading: false, segments: ["(auth)", "signUp"], justRegistered: true })
    ).toBe("/onboarding");
    // Also covers the Google sign-up path, which lands on the same segments.
    expect(
      getRedirectTarget({ isAuthenticated: true, loading: false, segments: ["(auth)", "logIn"], justRegistered: true })
    ).toBe("/onboarding");
  });

  it("does not send a returning user to onboarding just because justRegistered was left set somewhere it shouldn't be", () => {
    expect(getRedirectTarget({ isAuthenticated: true, loading: false, segments: ["(tabs)"], justRegistered: true })).toBeNull();
    expect(getRedirectTarget({ isAuthenticated: true, loading: false, segments: ["my-pets"], justRegistered: true })).toBeNull();
  });

  it("leaves an authenticated user alone everywhere else", () => {
    for (const segments of [["(tabs)"], ["my-pets"], ["payments"], ["help"], ["onboarding"], ["baby-book", "petid123"]]) {
      expect(getRedirectTarget({ isAuthenticated: true, loading: false, segments })).toBeNull();
    }
  });

  it("is stable once a redirect is applied — landing on the target produces no further redirect (no loop)", () => {
    const first = getRedirectTarget({ isAuthenticated: false, loading: false, segments: ["my-pets"] });
    expect(first).toBe("/(auth)/logIn");
    // Re-evaluating as if we've now landed on that target...
    const second = getRedirectTarget({ isAuthenticated: false, loading: false, segments: ["(auth)", "logIn"] });
    expect(second).toBeNull();

    const third = getRedirectTarget({ isAuthenticated: true, loading: false, segments: ["(auth)", "logIn"] });
    expect(third).toBe("/(tabs)");
    const fourth = getRedirectTarget({ isAuthenticated: true, loading: false, segments: ["(tabs)"] });
    expect(fourth).toBeNull();
  });
});
