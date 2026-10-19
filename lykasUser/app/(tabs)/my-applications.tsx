import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { View, Text, FlatList, Pressable } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getApiErrorMessage } from "../../utils/api";
import { formatDate, titleCase } from "../../utils/format";
import StateView from "../../components/StateView";
import StatusBadge from "../../components/StatusBadge";
import colors from "../../utils/colors";
import { fetchMyApplications, type ApplicationSummary } from "../../utils/applications";

export default function MyApplicationsScreen() {
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setApplications(await fetchMyApplications());
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load your applications"));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="flex-row items-center gap-2 px-5 pb-3 pt-2">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <Text className="font-display text-xl text-ink">My Applications</Text>
      </View>

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={load} />
      ) : applications.length === 0 ? (
        <StateView state="empty" title="No applications yet" message="Browse pets and apply to adopt or foster to see them here." />
      ) : (
        <FlatList
          data={applications}
          keyExtractor={(a) => a._id}
          contentContainerClassName="px-5 pb-8 gap-3"
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/application-details/${item._id}`)}
              className="rounded-2xl border border-border bg-white p-4"
            >
              <View className="mb-1 flex-row items-center justify-between">
                <Text className="font-sans-medium text-base text-ink">{item.pet?.name}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text className="mb-2 font-sans text-xs text-muted">
                {titleCase(item.type)} application · Submitted {formatDate(item.createdAt)}
              </Text>
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="git-branch-outline" size={14} color={colors.primary} />
                <Text className="font-sans text-xs text-ink">Currently: {titleCase(item.stage)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
