import { useCallback, useEffect, useState } from "react";
import { useRealtime } from "../../context/RealtimeContext";
import { View, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import PrimaryButton from "../../components/PrimaryButton";
import StateView from "../../components/StateView";
import StatusBadge from "../../components/StatusBadge";
import { api, getApiErrorMessage } from "../../utils/api";
import colors from "../../utils/colors";

export default function PaymentSuccessScreen() {
  const { paymentId } = useLocalSearchParams<{ paymentId?: string }>();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!paymentId) return;
    try {
      const res = await api.get(`/api/payments/my/${paymentId}`);
      setStatus(res.data.data.status);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to check payment status"));
    }
  }, [paymentId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  // The server pushes the moment the webhook marks the payment paid; the
  // poll above stays as a fallback.
  useRealtime(["Payment"], () => {
    void load();
  });

  if (error) return <SafeAreaView className="flex-1 bg-cream"><StateView state="error" message={error} onRetry={load} /></SafeAreaView>;

  const confirmed = status === "paid";
  const terminalFailure = status === "failed" || status === "cancelled";

  return (
    <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-cream px-8">
      <Ionicons name={confirmed ? "checkmark-circle" : terminalFailure ? "close-circle" : "time"} size={56} color={confirmed ? colors.status.success : terminalFailure ? colors.status.neutral : colors.primary} />
      <Text className="text-center font-display text-2xl text-ink">{confirmed ? "Payment successful" : terminalFailure ? `Payment ${status}` : "Payment pending"}</Text>
      <StatusBadge status={status || "pending"} />
      <Text className="text-center font-sans text-sm text-muted">
        {confirmed ? "Your payment has been confirmed by PayMongo." : terminalFailure ? "No successful payment has been confirmed. You can try again when ready." : "We are waiting for PayMongo to confirm the transaction. This screen does not confirm payment by itself."}
      </Text>
      <PrimaryButton label="Back to home" onPress={() => router.replace("/(tabs)")} className="mt-2" />
    </SafeAreaView>
  );
}
