import { useCallback, useEffect, useState } from "react";
import { useRealtimeReload, useSilentFlag } from "../context/RealtimeContext";
import { View, Text, FlatList, Pressable, Alert } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../utils/api";
import AppointmentCard, { type AppointmentSummary } from "../components/AppointmentCard";
import StateView from "../components/StateView";
import colors from "../utils/colors";

export default function MyAppointmentsScreen() {
  const [appointments, setAppointments] = useState<AppointmentSummary[]>([]);
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
      const res = await api.get("/api/appointments/my-appointments");
      setAppointments(res.data.data);
    } catch (err) {
      if (!silent) setError(getApiErrorMessage(err, "Failed to load your appointments"));
    } finally {
      setLoading(false);
    }
  }, [live]);

  useRealtimeReload(["Appointment"], load, live);

  useEffect(() => {
    load();
  }, [load]);

  function confirmCancel(id: string) {
    Alert.alert("Cancel this appointment?", "You can enroll again later if a spot is open.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel appointment",
        style: "destructive",
        onPress: async () => {
          try {
            await api.post(`/api/appointments/${id}/cancel`);
            load();
          } catch (err) {
            Alert.alert("Couldn't cancel", getApiErrorMessage(err));
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
        <View className="flex-row items-center gap-2">
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
          <Text className="font-display text-xl text-ink">My Appointments</Text>
        </View>
        <Pressable onPress={() => router.push("/appointments")} accessibilityRole="button">
          <Text className="font-sans-medium text-sm text-primary">Browse</Text>
        </Pressable>
      </View>

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={load} />
      ) : appointments.length === 0 ? (
        <StateView state="empty" title="No appointments yet" message="Browse open shifts and visits to enroll." />
      ) : (
        <FlatList
          data={appointments}
          keyExtractor={(a) => a._id}
          contentContainerClassName="px-5 pb-8 gap-3"
          renderItem={({ item }) => (
            <Pressable onLongPress={() => confirmCancel(item._id)}>
              <AppointmentCard appointment={item} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
