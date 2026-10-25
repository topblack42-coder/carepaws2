import { useCallback, useEffect, useState } from "react";
import { useRealtimeReload, useSilentFlag } from "../context/RealtimeContext";
import { View, Text, FlatList, Pressable } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../utils/api";
import { formatCurrency, formatDate, titleCase } from "../utils/format";
import StateView from "../components/StateView";
import StatusBadge from "../components/StatusBadge";
import colors from "../utils/colors";

interface PaymentRecord {
  _id: string;
  type: string;
  amount: number;
  status: string;
  createdAt: string;
}

export default function PaymentsScreen() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
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
      const res = await api.get("/api/payments/my");
      setPayments(res.data.data);
    } catch (err) {
      if (!silent) setError(getApiErrorMessage(err, "Failed to load payment history"));
    } finally {
      setLoading(false);
    }
  }, [live]);

  useRealtimeReload(["Payment"], load, live);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="flex-row items-center gap-2 px-5 pb-3 pt-2">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <Text className="font-display text-xl text-ink">Payment History</Text>
      </View>

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={load} />
      ) : payments.length === 0 ? (
        <StateView state="empty" title="No payments yet" />
      ) : (
        <FlatList
          data={payments}
          keyExtractor={(p) => p._id}
          contentContainerClassName="px-5 pb-8 gap-2"
          renderItem={({ item }) => (
            <View className="flex-row items-center justify-between rounded-xl border border-border bg-white px-4 py-3">
              <View>
                <Text className="font-sans-medium text-sm text-ink">{titleCase(item.type)}</Text>
                <Text className="font-sans text-xs text-muted">{formatDate(item.createdAt)}</Text>
              </View>
              <View className="items-end gap-1">
                <Text className="font-sans-bold text-sm text-ink">{formatCurrency(item.amount)}</Text>
                <StatusBadge status={item.status} />
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
