import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../../utils/api";
import { useAuth } from "../../context/AuthContext";
import StateView from "../../components/StateView";
import StatusBadge from "../../components/StatusBadge";
import PrimaryButton from "../../components/PrimaryButton";
import PetVideoPlayer, { type PetVideoInfo } from "../../components/PetVideoPlayer";
import { needsEmailVerification, promptVerifyEmail } from "../../utils/emailVerification";
import colors from "../../utils/colors";

interface PetDetail {
  _id: string;
  name: string;
  species: string;
  breed?: string;
  age?: number;
  gender?: string;
  size?: string;
  temperament?: string;
  energyLevel?: string;
  healthStatus?: string;
  description?: string;
  status: string;
  imageUrl?: string | null;
  video?: PetVideoInfo | null;
}

export default function PetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [pet, setPet] = useState<PetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [togglingFavorite, setTogglingFavorite] = useState(false);

  // Responses can arrive out of order when moving between pets; only the
  // most recent request may update the screen, so one pet's data (and
  // video) can never appear on another pet's page.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const [petRes, favoritesRes] = await Promise.all([
        api.get(`/api/pets/${id}`),
        user ? api.get("/api/auth/favorites") : Promise.resolve({ data: { data: [] } }),
      ]);
      if (request !== requestRef.current) return;
      setPet(petRes.data.data);
      setIsFavorite(favoritesRes.data.data.some((favPet: { _id: string }) => favPet._id === id));
    } catch (err) {
      if (request !== requestRef.current) return;
      setError(getApiErrorMessage(err, "Failed to load this pet"));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleFavorite() {
    if (!id) return;
    setTogglingFavorite(true);
    const previous = isFavorite;
    setIsFavorite(!previous); // optimistic
    try {
      await api.post(`/api/auth/favorites/${id}`);
    } catch {
      setIsFavorite(previous); // revert on failure
    } finally {
      setTogglingFavorite(false);
    }
  }

  // Applying (adoption or foster) requires a verified email: prompt here
  // instead of letting the form fail on submit.
  function startApplication(path: string) {
    if (needsEmailVerification(user)) {
      promptVerifyEmail();
      return;
    }
    router.push(path);
  }

  if (loading) return <StateView state="loading" />;
  if (error || !pet) return <StateView state="error" message={error ?? "Pet not found"} onRetry={load} />;

  const facts = [
    { label: "Gender", value: pet.gender },
    { label: "Size", value: pet.size },
    { label: "Age", value: pet.age ? `${pet.age} yrs` : undefined },
    { label: "Energy", value: pet.energyLevel },
    { label: "Temperament", value: pet.temperament },
  ].filter((f) => f.value);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <ScrollView contentContainerClassName="pb-12">
        <View className="h-72 bg-cardBg">
          {pet.imageUrl ? (
            <Image source={{ uri: pet.imageUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Ionicons name="paw" size={48} color={colors.sand} />
            </View>
          )}
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="absolute left-4 top-4 rounded-full bg-white/90 p-2.5">
            <Ionicons name="chevron-back" size={20} color={colors.ink} />
          </Pressable>
          {user && (
            <Pressable
              onPress={toggleFavorite}
              disabled={togglingFavorite}
              accessibilityRole="button"
              accessibilityLabel="Toggle favorite"
              className="absolute right-4 top-4 rounded-full bg-white/90 p-2.5"
            >
              <Ionicons name={isFavorite ? "heart" : "heart-outline"} size={20} color={colors.accentOrange} />
            </Pressable>
          )}
        </View>

        <View className="px-5 pt-4">
          <View className="mb-1 flex-row items-center justify-between">
            <Text className="font-display text-2xl text-ink">{pet.name}</Text>
            <StatusBadge status={pet.status} />
          </View>
          <Text className="mb-4 font-sans text-sm text-muted">
            {pet.species}
            {pet.breed ? ` · ${pet.breed}` : ""}
          </Text>

          <View className="mb-4 flex-row flex-wrap gap-2">
            {facts.map((f) => (
              <View key={f.label} className="rounded-full bg-cardBg px-3 py-1.5">
                <Text className="font-sans text-xs text-slate">
                  {f.label}: {f.value}
                </Text>
              </View>
            ))}
          </View>

          {pet.video && pet._id === id && <PetVideoPlayer key={`${pet._id}:${pet.video.url}`} petName={pet.name} video={pet.video} />}

          {pet.healthStatus && (
            <View className="mb-4 rounded-xl bg-mintBg px-4 py-3">
              <Text className="font-sans-medium text-xs text-mintDeep">Health: {pet.healthStatus}</Text>
            </View>
          )}

          {pet.description && (
            <View className="mb-6">
              <Text className="mb-1 font-sans-medium text-sm text-ink">About {pet.name}</Text>
              <Text className="font-sans text-sm leading-6 text-slate">{pet.description}</Text>
            </View>
          )}

          {pet.status === "Available" && (
            <View className="gap-3">
              <PrimaryButton label={`Apply to adopt ${pet.name}`} onPress={() => startApplication(`/pets/apply/${pet._id}`)} />
              <PrimaryButton
                variant="secondary"
                label={`Apply to foster ${pet.name}`}
                onPress={() => startApplication(`/pets/apply/${pet._id}?type=foster`)}
              />
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}