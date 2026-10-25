import { useCallback, useEffect, useState } from "react";
import { useRealtimeReload, useSilentFlag } from "../../context/RealtimeContext";
import { View, Text, FlatList, Pressable, TextInput, ScrollView } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../../utils/api";
import PetCard, { type PetSummary } from "../../components/PetCard";
import StateView from "../../components/StateView";
import colors from "../../utils/colors";

const SPECIES_FILTERS = ["All", "Dog", "Cat", "Other"];

export default function AdoptScreen() {
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [species, setSpecies] = useState("All");
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const live = useSilentFlag();

  const load = useCallback(async () => {
    const silent = live.take();
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const params: Record<string, string> = { status: "Available", limit: "50" };
      if (search) params.q = search;
      if (species !== "All") params.species = species;
      const res = await api.get("/api/pets", { params });
      setPets(res.data.data);
    } catch (err) {
      if (!silent) setError(getApiErrorMessage(err, "Failed to load pets"));
    } finally {
      setLoading(false);
    }
  }, [live, search, species]);

  useRealtimeReload(["Pet"], load, live);

  useEffect(() => {
    const timeout = setTimeout(load, 300); // debounce search
    return () => clearTimeout(timeout);
  }, [load]);

  function toggleCompare(id: string) {
    setCompareIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 3 ? [...prev, id] : prev));
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="px-5 pb-3 pt-2">
        <Text className="mb-3 font-display text-xl text-ink">Find a pet</Text>

        <View className="mb-3 flex-row items-center gap-2 rounded-xl border border-border bg-white px-3">
          <Ionicons name="search" size={16} color={colors.mutedLight} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or breed…"
            placeholderTextColor={colors.mutedLight}
            className="flex-1 py-3 font-sans text-sm text-ink"
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {SPECIES_FILTERS.map((s) => (
            <Pressable
              key={s}
              onPress={() => setSpecies(s)}
              className={`rounded-full border px-4 py-1.5 ${species === s ? "border-primary bg-primary" : "border-border bg-white"}`}
            >
              <Text className={`font-sans-medium text-sm ${species === s ? "text-white" : "text-ink"}`}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {compareIds.length > 0 && (
        <Pressable
          onPress={() => router.push({ pathname: "/compare-pets", params: { ids: compareIds.join(",") } })}
          className="mx-5 mb-3 flex-row items-center justify-center gap-2 rounded-xl bg-accentOrange px-4 py-3"
        >
          <Ionicons name="swap-horizontal" size={16} color="#fff" />
          <Text className="font-sans-bold text-sm text-white">Compare {compareIds.length} pets</Text>
        </Pressable>
      )}

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={load} />
      ) : pets.length === 0 ? (
        <StateView state="empty" title="No pets match your search" message="Try a different filter or search term." />
      ) : (
        <FlatList
          data={pets}
          keyExtractor={(p) => p._id}
          numColumns={2}
          contentContainerClassName="px-5 pb-8 gap-3"
          columnWrapperClassName="gap-3"
          renderItem={({ item }) => (
            <View style={{ flex: 1 }}>
              <PetCard pet={item} onPress={() => router.push(`/pets/${item._id}`)} />
              <Pressable
                onPress={() => toggleCompare(item._id)}
                className="mt-1.5 flex-row items-center justify-center gap-1 rounded-lg border border-border py-1.5"
              >
                <Ionicons
                  name={compareIds.includes(item._id) ? "checkbox" : "square-outline"}
                  size={14}
                  color={compareIds.includes(item._id) ? colors.primary : colors.mutedLight}
                />
                <Text className="font-sans text-xs text-muted">Compare</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
