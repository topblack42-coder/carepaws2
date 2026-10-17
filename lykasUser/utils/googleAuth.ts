import { GoogleSignin } from "@react-native-google-signin/google-signin";

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID?.trim();
const iosClientId = process.env.EXPO_PUBLIC_IOS_CLIENT_ID?.trim();

// The web client ID is intentionally public: it is embedded in the app and is
// used as the audience for the ID token verified by the backend.
GoogleSignin.configure({
  webClientId: webClientId || undefined,
  iosClientId: iosClientId || undefined,
});

console.info("[GoogleAuth] configuration", {
  webClientIdPresent: Boolean(webClientId),
  iosClientIdPresent: Boolean(iosClientId),
});

export function isGoogleSignInConfigured() {
  return Boolean(webClientId);
}

/**
 * Runs native Google Sign-In and returns only the ID token needed by CarePaws.
 * The cancellation case is represented as null so callers do not show an
 * authentication error when the user simply closes the account picker.
 */
export async function getGoogleIdToken(): Promise<string | null> {
  if (!webClientId) {
    throw new Error("Google sign-in is not configured for this build.");
  }

  await GoogleSignin.hasPlayServices();
  const result = await GoogleSignin.signIn();

  if (result.type === "cancelled") return null;

  const idToken = result.data.idToken;
  console.info("[GoogleAuth] native sign-in result", {
    type: result.type,
    userPresent: Boolean(result.data.user),
    idTokenPresent: Boolean(idToken),
  });

  if (!idToken) throw new Error("Google sign-in didn't return a token");
  return idToken;
}
