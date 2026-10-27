import { useCallback, useState } from "react";
import { useRealtimeReload, useSilentFlag } from "../../context/RealtimeContext";
import { View, Text, ScrollView, Pressable } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../../utils/api";
import { formatDateTime, titleCase } from "../../utils/format";
import StateView from "../../components/StateView";
import StatusBadge from "../../components/StatusBadge";
import colors from "../../utils/colors";
import { STAGE_ORDER } from "../../utils/applications";


interface StageHistoryEntry {
  stage: string;
  changedAt: string;
  note?: string;
}

interface Pickup {
  _id: string;
  application: string;
  scheduledDate: string;
  method: string;
  location?: string;
  status: "scheduled" | "completed" | "cancelled" | "no-show";
  cancelReason?: string;
}

interface ApplicationDetail {
  _id: string;
  pet: { name: string; imageUrl?: string };
  type?: "adoption" | "foster";
  status: string;
  stage: string;
  stageHistory: StageHistoryEntry[];
  createdAt: string;
}

export default function ApplicationDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [pickup, setPickup] = useState<Pickup | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const live = useSilentFlag();

  const load = useCallback(async () => {
    if (!id) return;
    const silent = live.take();
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await api.get(`/api/applications/${id}`);
      setApplication(res.data.data);
      try {
        const mine = await api.get("/api/feedback/my");
        setReviewed((mine.data.data as Array<{ application?: string }>).some((f) => String(f.application) === String(id)));
      } catch {
        setReviewed(false); // The review prompt is optional; never block the page on it.
      }
      try {
        // Newest pickup for this application (the list is sorted newest first).
        const pickups = await api.get("/api/adoption-pickups/my");
        setPickup((pickups.data.data as Pickup[]).find((p) => String(p.application) === String(id)) ?? null);
      } catch {
        setPickup(null); // The pickup card is optional; never block the page on it.
      }
    } catch (err) {
      if (!silent) setError(getApiErrorMessage(err, "Failed to load this application"));
    } finally {
      setLoading(false);
    }
  }, [live, id]);

  useRealtimeReload(["Application", "Interview", "HomeVisit", "AdoptionPickup", "RiskAssessment", "Payment", "UserDocument"], load, live);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) return <StateView state="loading" />;
  if (error || !application) return <StateView state="error" message={error ?? "Application not found"} onRetry={load} />;

  const currentIndex = STAGE_ORDER.indexOf(application.stage);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="flex-row items-center gap-2 px-5 pb-3 pt-2">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <Text className="font-display text-xl text-ink">Application status</Text>
      </View>

      <ScrollView contentContainerClassName="px-5 pb-8">
        <View className="mb-6 rounded-2xl border border-border bg-white p-4">
          <View className="mb-1 flex-row items-center justify-between">
            <Text className="font-display text-lg text-ink">{application.pet?.name}</Text>
            <StatusBadge status={application.status} />
          </View>
          <Text className="font-sans text-xs text-muted">
            {titleCase(application.type ?? "adoption")} application · Submitted {formatDateTime(application.createdAt)}
          </Text>
        </View>

        {application.status === "pending" && (
          <Pressable
            onPress={() => router.push({ pathname: "/documents", params: { applicationId: application._id } })}
            className="mb-5 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 py-3"
          >
            <Ionicons name="cloud-upload-outline" size={18} color={colors.primary} />
            <Text className="font-sans-medium text-sm text-primary">Upload application documents</Text>
          </Pressable>
        )}

        <Text className="mb-3 font-sans-medium text-sm text-ink">Pipeline progress</Text>
        <View className="mb-6">
          {STAGE_ORDER.map((stage, i) => {
            const isDone = application.stage !== "rejected" && i <= currentIndex;
            const isCurrent = stage === application.stage;
            return (
              <View key={stage} className="flex-row gap-3">
                <View className="items-center">
                  <View
                    className={`h-6 w-6 items-center justify-center rounded-full ${
                      isDone ? "bg-primary" : "border-2 border-border bg-white"
                    }`}
                  >
                    {isDone && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                  {i < STAGE_ORDER.length - 1 && <View className={`w-0.5 flex-1 ${isDone ? "bg-primary" : "bg-border"}`} style={{ minHeight: 24 }} />}
                </View>
                <View className="flex-1 pb-5">
                  <Text className={`font-sans-medium text-sm ${isCurrent ? "text-primary" : isDone ? "text-ink" : "text-mutedLight"}`}>
                    {titleCase(stage)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {application.type !== "foster" && application.stage === "completed" && (
          <View className="mb-5 rounded-2xl border border-border bg-white p-4">
            <View className="mb-2 flex-row items-center gap-2">
              <Ionicons name="star-outline" size={18} color={colors.primary} />
              <Text className="font-sans-medium text-sm text-ink">Your review</Text>
            </View>
            {reviewed ? (
              <Text className="font-sans text-sm text-mintDeep">Thanks for reviewing your adoption!</Text>
            ) : (
              <>
                <Text className="mb-3 font-sans text-sm text-muted">How was your adoption experience with {application.pet?.name ? `${application.pet.name} and ` : ""}CarePaws?</Text>
                <Pressable
                  onPress={() => router.push({ pathname: "/feedback", params: { applicationId: application._id } })}
                  accessibilityRole="button"
                  className="items-center rounded-xl bg-primary px-4 py-3"
                >
                  <Text className="font-sans-medium text-sm text-white">Leave a review</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {application.type === "foster" && application.status === "approved" && (
          <View className="mb-5 rounded-xl bg-mintBg px-4 py-3">
            <Text className="font-sans-medium text-sm text-mintDeep">Our team will contact you to start the foster placement.</Text>
          </View>
        )}

        {application.type !== "foster" && application.status === "approved" && (
          <View className="mb-5 rounded-2xl border border-border bg-white p-4">
            <View className="mb-2 flex-row items-center gap-2">
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <Text className="font-sans-medium text-sm text-ink">Pet pickup</Text>
            </View>
            {pickup?.status === "scheduled" ? (
              <>
                <Text className="font-sans-medium text-base text-ink">{formatDateTime(pickup.scheduledDate)}</Text>
                <Text className="mt-1 font-sans text-sm text-muted">
                  {pickup.method === "Home delivery" ? `Delivery to ${pickup.location}` : `Pick up at ${pickup.location || "the shelter"}`}
                </Text>
                <Text className="mt-2 font-sans text-xs text-muted">Please bring a valid ID. Contact the shelter from Help if you need to change the time.</Text>
              </>
            ) : pickup?.status === "completed" ? (
              <Text className="font-sans text-sm text-mintDeep">
                Your pet was handed over{pickup.scheduledDate ? ` on ${formatDateTime(pickup.scheduledDate)}` : ""}. Congratulations!
              </Text>
            ) : pickup && (pickup.status === "cancelled" || pickup.status === "no-show") ? (
              <Text className="font-sans text-sm text-muted">
                {pickup.status === "no-show" ? "The last pickup was missed." : pickup.cancelReason || "The last pickup was cancelled."} The shelter will contact you to arrange a new time.
              </Text>
            ) : (
              <Text className="font-sans text-sm text-muted">You&apos;re approved! The shelter will schedule your pet&apos;s pickup and notify you here.</Text>
            )}
          </View>
        )}

        {application.stage === "rejected" && (
          <View className="mb-5 rounded-xl border border-status-danger/20 bg-status-dangerBg px-4 py-3">
            <Text className="font-sans-medium text-sm text-status-danger">Application rejected</Text>
          </View>
        )}

        {application.stageHistory?.length > 0 && (
          <>
            <Text className="mb-3 font-sans-medium text-sm text-ink">History</Text>
            {application.stageHistory
              .slice()
              .reverse()
              .map((entry, i) => (
                <View key={i} className="mb-2 rounded-xl border border-border bg-white px-4 py-3">
                  <Text className="font-sans-medium text-xs text-ink">{titleCase(entry.stage)}</Text>
                  <Text className="mt-0.5 font-sans text-xs text-muted">{formatDateTime(entry.changedAt)}</Text>
                  {entry.note && <Text className="mt-1 font-sans text-xs text-slate">{entry.note}</Text>}
                </View>
              ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
