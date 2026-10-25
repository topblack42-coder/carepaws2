import { useCallback, useEffect, useState } from "react";
import { useRealtimeReload, useSilentFlag } from "../../context/RealtimeContext";
import { View, Text, FlatList } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, getApiErrorMessage } from "../../utils/api";
import PetCard, { type PetSummary } from "../../components/PetCard";
import StateView from "../../components/StateView";

export default function FavoritesScreen() {
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const live = useSilentFlag();

  const load = useCallback(async () => {
    const silent = live.take();
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await api.get("/api/auth/favorites");
      setPets(res.data.data);
    } catch (err) {
      if (!silent) setError(getApiErrorMessage(err, "Failed to load favorites"));
    } finally {
      setLoading(false);
    }
  }, [live]);

  useRealtimeReload(["User", "Pet"], load, live);

  // Reload whenever the tab regains focus (a pet may have been
  // favorited/unfavorited from its detail screen).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="px-5 pb-3 pt-2">
        <Text className="font-display text-xl text-ink">Your favorites</Text>
      </View>

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={load} />
      ) : pets.length === 0 ? (
        <StateView state="empty" title="No favorites yet" message="Tap the heart on a pet's profile to save it here." />
      ) : (
        <FlatList
          data={pets}
          keyExtractor={(p) => p._id}
          numColumns={2}
          contentContainerClassName="px-5 pb-8 gap-3"
          columnWrapperClassName="gap-3"
          renderItem={({ item }) => (
            <View style={{ flex: 1 }}>
              <PetCard pet={item} favorite onPress={() => router.push(`/pets/${item._id}`)} />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
