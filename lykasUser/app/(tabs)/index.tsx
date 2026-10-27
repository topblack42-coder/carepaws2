import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRealtimeReload, useSilentFlag } from "../../context/RealtimeContext";
import { View, Text, ScrollView, RefreshControl, FlatList, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, getApiErrorMessage } from "../../utils/api";
import { useAuth } from "../../context/AuthContext";
import { fetchMyApplications, type ApplicationSummary } from "../../utils/applications";
import PetCard, { type PetSummary } from "../../components/PetCard";
import StateView from "../../components/StateView";
import ApplicationsSection from "../../components/ApplicationsSection";
import DonationCard from "../../components/DonationCard";
import NotificationBell from "../../components/NotificationBell";
import NotificationBanner from "../../components/NotificationBanner";
import ReviewsSection from "../../components/ReviewsSection";
import { useNotificationSummary } from "../../hooks/useNotificationSummary";
import colors from "../../utils/colors";

interface Announcement {
  _id: string;
  title: string;
  message: string;
  level: "info" | "warning" | "critical";
}

export default function HomeScreen() {
  const { user } = useAuth();
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [petsLoading, setPetsLoading] = useState(true);
  const [petsError, setPetsError] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const notifications = useNotificationSummary();

  // Live refreshes keep what is on screen: no error banner if they fail.
  const livePets = useSilentFlag();
  const liveApps = useSilentFlag();

  const loadPets = useCallback(async () => {
    const silent = livePets.take();
    if (!silent) setPetsError(null);
    try {
      const res = await api.get("/api/pets", { params: { limit: 6, status: "Available" } });
      setPets(res.data.data);
    } catch (err) {
      if (!silent) setPetsError(getApiErrorMessage(err, "Failed to load pets"));
    } finally {
      setPetsLoading(false);
    }
  }, [livePets]);

  const loadAnnouncements = useCallback(async () => {
    try {
      const res = await api.get("/api/announcements/active");
      setAnnouncements(res.data.data);
    } catch {
      // Announcements are optional; a failure must not affect the rest of Home.
    }
  }, []);

  const loadApplications = useCallback(async () => {
    const silent = liveApps.take();
    if (!silent) setAppsError(null);
    try {
      setApplications(await fetchMyApplications());
    } catch (err) {
      if (!silent) setAppsError(getApiErrorMessage(err, "Failed to load your applications"));
    } finally {
      setAppsLoading(false);
    }
  }, [liveApps]);

  useRealtimeReload(["Pet"], loadPets, livePets);
  useRealtimeReload(["Application"], loadApplications, liveApps);
  useRealtime(["Announcement"], () => {
    void loadAnnouncements();
  });

  const retryApplications = useCallback(() => {
    setAppsLoading(true);
    loadApplications();
  }, [loadApplications]);

  const retryPets = useCallback(() => {
    setPetsLoading(true);
    loadPets();
  }, [loadPets]);

  useEffect(() => {
    // Each loader catches its own errors, so allSettled keeps sections independent.
    Promise.allSettled([loadPets(), loadAnnouncements()]);
  }, [loadPets, loadAnnouncements]);

  // Keep application status fresh when returning from detail/apply screens.
  useFocusEffect(
    useCallback(() => {
      loadApplications();
    }, [loadApplications])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([loadPets(), loadAnnouncements(), loadApplications(), notifications.reload()]);
    setRefreshing(false);
  }, [loadPets, loadAnnouncements, loadApplications, notifications.reload]);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView
        contentContainerClassName="px-5 pb-10 pt-2"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View className="mb-6 flex-row items-center justify-between">
          <View>
            <Text className="font-sans text-sm text-muted">Welcome back,</Text>
            <Text className="font-display text-xl text-ink">{user?.displayName?.split(" ")[0]}</Text>
          </View>
          <NotificationBell count={notifications.count} />
        </View>

        {notifications.latest && (
          <NotificationBanner notification={notifications.latest} unreadCount={notifications.count} onDismiss={notifications.dismissLatest} />
        )}

        {announcements.map((a) => (
          <View
            key={a._id}
            className={`mb-3 rounded-2xl border px-4 py-3 ${
              a.level === "critical" ? "border-status-danger/20 bg-status-dangerBg" : a.level === "warning" ? "border-status-warning/20 bg-status-warningBg" : "border-border bg-white"
            }`}
          >
            <Text className="font-sans-medium text-sm text-ink">{a.title}</Text>
            <Text className="mt-0.5 font-sans text-xs text-muted">{a.message}</Text>
          </View>
        ))}

        <ApplicationsSection applications={applications} loading={appsLoading} error={appsError} onRetry={retryApplications} />

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="font-display text-lg text-ink">Pets looking for a home</Text>
          <Pressable
            onPress={() => router.push("/(tabs)/adopt")}
            accessibilityRole="link"
            accessibilityLabel="See all pets"
            className="min-h-[44px] justify-center pl-3 active:opacity-60"
          >
            <Text className="font-sans-medium text-sm text-primary">See all</Text>
          </Pressable>
        </View>

        <View className="mb-6">
          {petsLoading ? (
            <View className="flex-row gap-3" testID="pets-skeleton">
              {[0, 1].map((i) => (
                <View key={i} className="h-[240px] w-[160px] rounded-2xl border border-border bg-cardBg" />
              ))}
            </View>
          ) : petsError ? (
            <View className="rounded-2xl border border-border bg-white">
              <StateView state="error" title="Couldn't load pets" message={petsError} onRetry={retryPets} />
            </View>
          ) : pets.length === 0 ? (
            <StateView state="empty" title="No pets available right now" message="Check back soon — new pets are added regularly." />
          ) : (
            <FlatList
              horizontal
              data={pets}
              keyExtractor={(p) => p._id}
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => (
                <View style={{ width: 160, marginRight: 12 }}>
                  <PetCard pet={item} onPress={() => router.push(`/pets/${item._id}`)} />
                </View>
              )}
            />
          )}
        </View>

        <ReviewsSection />

        <Text className="mb-3 font-display text-lg text-ink">Ways to help</Text>
        <DonationCard />
      </ScrollView>
    </SafeAreaView>
  );
}
