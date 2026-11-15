import { useCallback, useEffect, useState } from "react";
import { useRealtimeReload, useSilentFlag } from "../context/RealtimeContext";
import { View, Text, FlatList, Pressable, Linking } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../utils/api";
import { formatDate } from "../utils/format";
import StateView from "../components/StateView";
import StatusBadge from "../components/StatusBadge";
import FormInput from "../components/FormInput";
import colors from "../utils/colors";

interface FosterPlacement {
  _id: string;
  pet: { _id: string; name: string; species: string };
  startDate: string;
  expectedEndDate?: string;
  status: string;
  emergencyContact?: { name?: string; phone?: string };
  returnRequest?: { urgency: "routine" | "emergency"; reason: string; status: "open" | "resolved" };
  weeklyReportsSubmitted: number;
  weeklyReportsRequired: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Ends in 3 days" / "Ended 2 days ago" for an active placement. */
function endText(expectedEndDate?: string): { text: string; late: boolean } | null {
  if (!expectedEndDate) return null;
  const ms = new Date(expectedEndDate).getTime() - Date.now();
  if (ms < 0) {
    const days = Math.max(1, Math.floor(-ms / DAY_MS));
    return { text: `Ended ${days} day${days === 1 ? "" : "s"} ago. Please contact the shelter`, late: true };
  }
  const days = Math.ceil(ms / DAY_MS);
  return { text: days <= 1 ? "Ends tomorrow" : `Ends in ${days} days`, late: days <= 7 };
}

/** Early / emergency return and emergency contact for one active placement. */
function ReturnAndContact({ foster, shelterPhone, onChanged }: { foster: FosterPlacement; shelterPhone: string | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [urgency, setUrgency] = useState<"routine" | "emergency">("routine");
  const [reason, setReason] = useState("");
  const [contactName, setContactName] = useState(foster.emergencyContact?.name ?? "");
  const [contactPhone, setContactPhone] = useState(foster.emergencyContact?.phone ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = foster.returnRequest?.status === "open" ? foster.returnRequest : null;

  async function sendReturn() {
    if (reason.trim().length < 5) {
      setMessage("Tell the shelter why you need to return the pet.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/api/foster/${foster._id}/return-request`, { urgency, reason: reason.trim() });
      setOpen(false);
      setReason("");
      onChanged();
    } catch (err) {
      setMessage(getApiErrorMessage(err, "Could not send your request"));
    } finally {
      setBusy(false);
    }
  }

  async function saveContact() {
    if (!contactName.trim() || contactPhone.trim().length < 5) {
      setMessage("Add a name and phone number for your emergency contact.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.put(`/api/foster/${foster._id}/emergency-contact`, { name: contactName.trim(), phone: contactPhone.trim() });
      setMessage("Emergency contact saved.");
      onChanged();
    } catch (err) {
      setMessage(getApiErrorMessage(err, "Could not save your emergency contact"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="mt-3 border-t border-border pt-3">
      {request && (
        <Text className={`mb-2 font-sans-medium text-xs ${request.urgency === "emergency" ? "text-status-danger" : "text-ink"}`}>
          {request.urgency === "emergency" ? "Emergency return requested" : "Return requested"}. The shelter will contact you.
        </Text>
      )}
      {!request && !open && (
        <Pressable onPress={() => setOpen(true)} accessibilityRole="button" testID={`foster-return-open-${foster._id}`}>
          <Text className="font-sans-medium text-sm text-primary">Need to return the pet early?</Text>
        </Pressable>
      )}
      {open && (
        <View>
          <View className="mb-3 flex-row gap-2">
            {(["routine", "emergency"] as const).map((u) => (
              <Pressable
                key={u}
                onPress={() => setUrgency(u)}
                accessibilityRole="button"
                accessibilityState={{ selected: urgency === u }}
                testID={`foster-urgency-${u}`}
                className={`flex-1 rounded-xl border px-3 py-2 ${urgency === u ? "border-primary bg-white" : "border-border"}`}
              >
                <Text className="text-center font-sans-medium text-sm text-ink">{u === "routine" ? "Not urgent" : "Emergency"}</Text>
              </Pressable>
            ))}
          </View>
          <FormInput label="Why do you need to return the pet?" value={reason} onChangeText={setReason} multiline testID="foster-return-reason" />
          <Pressable onPress={sendReturn} disabled={busy} accessibilityRole="button" testID="foster-return-send" className="items-center rounded-xl bg-primary py-3">
            <Text className="font-sans-medium text-sm text-white">{busy ? "Sending…" : "Send return request"}</Text>
          </Pressable>
        </View>
      )}
      {shelterPhone && (
        <Pressable onPress={() => Linking.openURL(`tel:${shelterPhone}`)} accessibilityRole="link" className="mt-3 flex-row items-center gap-1.5">
          <Ionicons name="call-outline" size={14} color={colors.primary} />
          <Text className="font-sans text-xs text-ink">Shelter emergency line: {shelterPhone}</Text>
        </Pressable>
      )}
      <View className="mt-3">
        <Text className="mb-1 font-sans-medium text-xs text-ink">Your emergency contact</Text>
        <Text className="mb-2 font-sans text-xs text-muted">Someone the shelter can call if it cannot reach you.</Text>
        <FormInput label="Name" value={contactName} onChangeText={setContactName} testID="foster-contact-name" />
        <FormInput label="Phone" value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" testID="foster-contact-phone" />
        <Pressable onPress={saveContact} disabled={busy} accessibilityRole="button" testID="foster-contact-save">
          <Text className="font-sans-medium text-sm text-primary">Save emergency contact</Text>
        </Pressable>
      </View>
      {message && <Text className="mt-2 font-sans text-xs text-muted" testID="foster-message">{message}</Text>}
    </View>
  );
}

export default function FosterDashboardScreen() {
  const [fosters, setFosters] = useState<FosterPlacement[]>([]);
  const [shelterPhone, setShelterPhone] = useState<string | null>(null);
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
      const res = await api.get("/api/foster/my");
      setFosters(res.data.data);
      setShelterPhone(res.data.meta?.shelterEmergencyPhone ?? null);
    } catch (err) {
      if (!silent) setError(getApiErrorMessage(err, "Failed to load your fosters"));
    } finally {
      setLoading(false);
    }
  }, [live]);

  useRealtimeReload(["Foster", "WeeklyFosterReport"], load, live);

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
            <View className="rounded-2xl border border-border bg-white p-4">
            <Pressable onPress={() => router.push(`/foster/${item.pet._id}`)} accessibilityRole="button">
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
              {item.status === "active" && endText(item.expectedEndDate) && (
                <Text className={`mt-1.5 font-sans text-xs ${endText(item.expectedEndDate)!.late ? "text-status-danger" : "text-muted"}`}>
                  {endText(item.expectedEndDate)!.text}
                </Text>
              )}
            </Pressable>
            {item.status === "active" && <ReturnAndContact foster={item} shelterPhone={shelterPhone} onChanged={load} />}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
