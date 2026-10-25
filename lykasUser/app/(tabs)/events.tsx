import { useCallback, useEffect, useState } from "react";
import { useRealtimeReload, useSilentFlag } from "../../context/RealtimeContext";
import { View, Text, FlatList, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../../utils/api";
import { formatDate } from "../../utils/format";
import StateView from "../../components/StateView";
import StatusBadge from "../../components/StatusBadge";
import colors from "../../utils/colors";

interface EventItem {
  _id: string;
  title: string;
  category: string;
  date: string;
  endDate?: string;
  location?: string;
  status: string;
  currentAttendees: number;
  maxAttendees?: number;
}

interface Registration {
  event?: { _id: string } | string;
  status: string;
}

export default function EventsScreen() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [registrations, setRegistrations] = useState<Record<string, Registration>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);

  const live = useSilentFlag();

  const load = useCallback(async () => {
    const silent = live.take();
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [eventsRes, registrationsRes] = await Promise.all([
        api.get("/api/events", { params: { status: "upcoming" } }),
        api.get("/api/events/my-registrations"),
      ]);
      setEvents(eventsRes.data.data);
      const active: Record<string, Registration> = {};
      for (const registration of registrationsRes.data.data as Registration[]) {
        const eventId = typeof registration.event === "string" ? registration.event : registration.event?._id;
        if (eventId && registration.status !== "cancelled") active[eventId] = registration;
      }
      setRegistrations(active);
    } catch (err) {
      if (!silent) setError(getApiErrorMessage(err, "Failed to load events"));
    } finally {
      setLoading(false);
    }
  }, [live]);

  useRealtimeReload(["Event", "EventRegistration"], load, live);

  useEffect(() => {
    load();
  }, [load]);

  async function register(event: EventItem) {
    setBusyEvent(event._id);
    try {
      await api.post(`/api/events/${event._id}/register`);
      await load();
      Alert.alert("Registered", `You're registered for ${event.title}.`);
    } catch (err) {
      Alert.alert("Couldn't register", getApiErrorMessage(err, "Registration failed"));
    } finally {
      setBusyEvent(null);
    }
  }

  async function unregister(event: EventItem) {
    setBusyEvent(event._id);
    try {
      await api.delete(`/api/events/${event._id}/register`);
      await load();
    } catch (err) {
      Alert.alert("Couldn't cancel", getApiErrorMessage(err, "Cancellation failed"));
    } finally {
      setBusyEvent(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="px-5 pb-3 pt-2">
        <Text className="font-display text-xl text-ink">Community events</Text>
      </View>

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={load} />
      ) : events.length === 0 ? (
        <StateView state="empty" title="No upcoming events" message="Check back soon for adoption drives and fundraisers." />
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e._id}
          contentContainerClassName="px-5 pb-8 gap-3"
          renderItem={({ item }) => {
            const registered = Boolean(registrations[item._id]);
            const full = item.maxAttendees !== undefined && item.currentAttendees >= item.maxAttendees;
            const disabled = busyEvent === item._id || item.status !== "upcoming" || (!registered && full);

            return (
              <View className="rounded-2xl border border-border bg-white p-4">
                <View className="mb-1 flex-row items-center justify-between">
                  <Text className="flex-1 font-sans-medium text-base text-ink" numberOfLines={1}>
                    {item.title}
                  </Text>
                  <StatusBadge status={item.category} tone="neutral" />
                </View>
                <View className="flex-row items-center gap-1.5">
                  <Ionicons name="calendar-outline" size={14} color={colors.muted} />
                  <Text className="font-sans text-xs text-muted">{formatDate(item.date)}</Text>
                </View>
                {item.location && (
                  <View className="mt-1 flex-row items-center gap-1.5">
                    <Ionicons name="location-outline" size={14} color={colors.muted} />
                    <Text className="font-sans text-xs text-muted">{item.location}</Text>
                  </View>
                )}
                <View className="mt-2 flex-row items-center justify-between">
                  <Text className="font-sans text-xs text-mutedLight">
                    {item.currentAttendees}{item.maxAttendees ? `/${item.maxAttendees}` : ""} attending
                  </Text>
                  <StatusBadge status={item.status} />
                </View>
                <Pressable
                  disabled={disabled}
                  onPress={() => (registered ? unregister(item) : register(item))}
                  className={`mt-3 items-center rounded-xl px-4 py-3 ${disabled ? "bg-border" : registered ? "bg-status-dangerBg" : "bg-primary"}`}
                >
                  <Text className={`font-sans-medium text-sm ${disabled ? "text-mutedLight" : registered ? "text-status-danger" : "text-white"}`}>
                    {busyEvent === item._id ? "Updating…" : registered ? "Cancel registration" : full ? "Event full" : "Register"}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
