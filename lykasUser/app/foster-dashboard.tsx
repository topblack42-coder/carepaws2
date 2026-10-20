import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../utils/api";
import { formatDate } from "../utils/format";
import StateView from "../components/StateView";
import StatusBadge from "../components/StatusBadge";
import colors from "../utils/colors";

interface FosterPlacement {
  _id: string;
  pet: { _id: string; name: string; species: string };
  startDate: string;
  status: string;
  weeklyReportsSubmitted: number;
  weeklyReportsRequired: number;
}

export default function FosterDashboardScreen() {
  const [fosters, setFosters] = useState<FosterPlacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/api/foster/my");
      setFosters(res.data.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load your fosters"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="flex-row items-center gap-2 px-5 pb-3 pt-2">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <Text className="font-display text-xl text-ink">Foster Dashboard</Text>
      </View>

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={load} />
      ) : fosters.length === 0 ? (
        <StateView state="empty" title="No active fosters" message="Apply to foster a pet from its profile page. Approved placements appear here." />
      ) : (
        <FlatList
          data={fosters}
          keyExtractor={(f) => f._id}
          contentContainerClassName="px-5 pb-8 gap-3"
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/foster/${item.pet._id}`)} className="rounded-2xl border border-border bg-white p-4">
              <View className="mb-1 flex-row items-center justify-between">
                <Text className="font-sans-medium text-base text-ink">{item.pet.name}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text className="mb-2 font-sans text-xs text-muted">Fostering since {formatDate(item.startDate)}</Text>
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="document-text-outline" size={14} color={colors.primary} />
                <Text className="font-sans text-xs text-ink">
                  {item.weeklyReportsSubmitted}/{item.weeklyReportsRequired} weekly reports submitted
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
