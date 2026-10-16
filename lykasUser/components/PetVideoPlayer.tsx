import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer, type VideoPlayerStatus } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import colors from "../utils/colors";

export interface PetVideoInfo {
  url: string;
  thumbnailUrl?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
}

const WIDEST = 16 / 9;
const TALLEST = 4 / 5;

function formatDuration(seconds?: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Fit the player to the clip (portrait phone videos shouldn't be squeezed
// into a letterbox) while keeping it within a sensible range on screen.
function aspectRatioFor(video: PetVideoInfo) {
  if (video.width && video.height) return Math.min(Math.max(video.width / video.height, TALLEST), WIDEST);
  return WIDEST;
}

/**
 * Mounted only after the adopter taps play, so opening a pet's page never
 * downloads or decodes video. Native controls provide play/pause, progress,
 * duration and fullscreen.
 */
function ActiveVideo({ url, ratio, onRetry }: { url: string; ratio: number; onRetry: () => void }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play(); // started by the adopter's tap — never automatically
  });
  const [status, setStatus] = useState<VideoPlayerStatus>(player.status);

  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status: next }) => setStatus(next));
    return () => subscription.remove();
  }, [player]);

  return (
    <View style={{ aspectRatio: ratio }} className="overflow-hidden rounded-2xl bg-ink">
      <VideoView
        player={player}
        style={{ width: "100%", height: "100%" }}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture={false}
      />
      {status === "loading" && (
        <View testID="pet-video-loading" pointerEvents="none" className="absolute inset-0 items-center justify-center bg-black/30">
          <ActivityIndicator color={colors.white} />
        </View>
      )}
      {status === "error" && (
        <View testID="pet-video-error" className="absolute inset-0 items-center justify-center bg-ink px-6">
          <Ionicons name="alert-circle-outline" size={28} color={colors.sand} />
          <Text className="mt-2 text-center font-sans text-sm text-white">This video couldn&apos;t be played. Check your connection and try again.</Text>
          <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry video" className="mt-3 rounded-full bg-white px-4 py-2">
            <Text className="font-sans-medium text-xs text-ink">Try again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/**
 * "Meet <pet>" section. Renders nothing at all when the pet has no video —
 * no placeholder, no empty container, no message.
 */
export default function PetVideoPlayer({ petName, video }: { petName: string; video?: PetVideoInfo | null }) {
  const [started, setStarted] = useState(false);
  const [attempt, setAttempt] = useState(0);

  if (!video || !video.url) return null;

  const ratio = aspectRatioFor(video);
  const duration = formatDuration(video.duration);

  return (
    <View className="mb-6" testID="pet-video-section">
      <Text className="mb-0.5 font-display text-lg text-ink">Meet {petName}</Text>
      <Text className="mb-3 font-sans text-sm text-muted">Get to know {petName} through this short introduction video.</Text>

      {started ? (
        <ActiveVideo
          key={`${video.url}:${attempt}`}
          url={video.url}
          ratio={ratio}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : (
        <Pressable
          onPress={() => setStarted(true)}
          accessibilityRole="button"
          accessibilityLabel={`Play introduction video of ${petName}`}
          style={{ aspectRatio: ratio }}
          className="items-center justify-center overflow-hidden rounded-2xl bg-ink"
        >
          {video.thumbnailUrl ? (
            <Image source={{ uri: video.thumbnailUrl }} style={{ position: "absolute", width: "100%", height: "100%" }} contentFit="cover" />
          ) : null}
          <View className="h-16 w-16 items-center justify-center rounded-full bg-white/90">
            <Ionicons name="play" size={28} color={colors.primary} />
          </View>
          {duration && (
            <View className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1">
              <Text className="font-sans-medium text-xs text-white">{duration}</Text>
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}
