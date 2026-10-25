import { useCallback, useEffect, useState } from "react";
import { useRealtimeReload, useSilentFlag } from "../context/RealtimeContext";
import { View, Text, FlatList, Pressable } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../utils/api";
import PetCard, { type PetSummary } from "../components/PetCard";
import StateView from "../components/StateView";
import colors from "../utils/colors";

export default function MyPetsScreen() {
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
      const res = await api.get("/api/pets/my-pets");
      setPets(res.data.data);
    } catch (err) {
      if (!silent) setError(getApiErrorMessage(err, "Failed to load your pets"));
    } finally {
      setLoading(false);
    }
  }, [live]);

  useRealtimeReload(["Pet"], load, live);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="flex-row items-center gap-2 px-5 pb-3 pt-2">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <Text className="font-display text-xl text-ink">My Pets</Text>
      </View>

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={load} />
      ) : pets.length === 0 ? (
        <StateView state="empty" title="No pets yet" message="Pets you've adopted will show up here." />
      ) : (
        <FlatList
          data={pets}
          keyExtractor={(p) => p._id}
          numColumns={2}
          contentContainerClassName="px-5 pb-8 gap-3"
          columnWrapperClassName="gap-3"
          renderItem={({ item }) => (
            <View style={{ flex: 1 }}>
              <PetCard pet={item} onPress={() => router.push(`/health/${item._id}`)} />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
