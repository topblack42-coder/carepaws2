import { useEffect } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import * as Updates from "expo-updates";
import colors from "../utils/colors";

/**
 * In-app "update available" notice for over-the-air (EAS Update) releases.
 *
 * expo-updates already checks on launch; this banner makes the result
 * visible. It also re-checks whenever the app returns to the foreground,
 * downloads a newer update in the background, and then offers a Restart
 * button. It renders nothing in development / Expo Go, where updates are
 * disabled. Changes that need new native code (new packages, app version
 * bump) still require a new build — OTA can't deliver those.
 */
export default function UpdateBanner() {
  const { isUpdatePending, isDownloading } = Updates.useUpdates();

  useEffect(() => {
    if (!Updates.isEnabled) return;

    async function checkAndFetch() {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) await Updates.fetchUpdateAsync();
      } catch {
        // Offline or no update channel reachable — try again next time.
      }
    }

    checkAndFetch();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") checkAndFetch();
    });
    return () => sub.remove();
  }, []);

  if (!Updates.isEnabled || (!isUpdatePending && !isDownloading)) return null;

  return (
    <View
      className="absolute left-4 right-4 top-12 z-50 flex-row items-center justify-between rounded-2xl bg-primary px-4 py-3"
      accessibilityRole="alert"
    >
      <Text className="mr-3 flex-1 font-sans-medium text-sm text-white">
        {isUpdatePending ? "A new version of CarePaws is ready." : "Downloading update…"}
      </Text>
      {isUpdatePending && (
        <Pressable
          onPress={() => Updates.reloadAsync()}
          accessibilityRole="button"
          accessibilityLabel="Restart to update"
          className="rounded-lg bg-white px-3 py-1.5"
        >
          <Text style={{ color: colors.primary }} className="font-sans-medium text-sm">
            Restart
          </Text>
        </Pressable>
      )}
    </View>
  );
}
