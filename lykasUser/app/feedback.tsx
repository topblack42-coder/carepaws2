import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../utils/api";
import FormInput from "../components/FormInput";
import PrimaryButton from "../components/PrimaryButton";
import StateView from "../components/StateView";
import StatusBadge from "../components/StatusBadge";
import colors from "../utils/colors";

const TYPES = [
  { value: "general", label: "General" },
  { value: "complaint", label: "Complaint" },
  { value: "review", label: "Review" },
  { value: "suggestion", label: "Suggestion" },
] as const;

export default function FeedbackScreen() {
  // Opened from a completed adoption: the review is tied to that application.
  const { applicationId } = useLocalSearchParams<{ applicationId?: string }>();
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>(applicationId ? "review" : "general");
  const [rating, setRating] = useState(0);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedbackItems, setFeedbackItems] = useState<Array<{ _id: string; type: string; subject?: string; message: string; status: string; adminResponse?: string; createdAt: string }>>([]);
  const [loadingFeedback, setLoadingFeedback] = useState(true);

  const loadFeedback = useCallback(async () => {
    try {
      const res = await api.get("/api/feedback/my");
      setFeedbackItems(res.data.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load your feedback"));
    } finally {
      setLoadingFeedback(false);
    }
  }, []);

  useEffect(() => { loadFeedback(); }, [loadFeedback]);

  async function handleSubmit() {
    if (!message) {
      setError("Please share your feedback.");
      return;
    }
    if (applicationId && !rating) {
      setError("Please choose a star rating.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/feedback", { type, rating: rating || undefined, subject, message, application: applicationId || undefined });
      setMessage(""); setSubject(""); setRating(0);
      await loadFeedback();
      Alert.alert("Thank you", "Your feedback has been submitted.");
      if (applicationId) router.back();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to submit feedback"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView contentContainerClassName="px-5 pb-8 pt-2" keyboardShouldPersistTaps="handled">
        <View className="mb-4 flex-row items-center gap-2">
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
          <Text className="font-display text-xl text-ink">{applicationId ? "Review your adoption" : "Share feedback"}</Text>
        </View>

        {error && (
          <View className="mb-4 rounded-xl border border-status-danger/20 bg-status-dangerBg px-4 py-3">
            <Text className="font-sans text-sm text-status-danger">{error}</Text>
          </View>
        )}

        {!applicationId && <View className="mb-4 flex-row flex-wrap gap-2">
          {TYPES.map((t) => (
            <Pressable
              key={t.value}
              onPress={() => setType(t.value)}
              className={`rounded-full border px-4 py-2 ${type === t.value ? "border-primary bg-primary" : "border-border bg-white"}`}
            >
              <Text className={`font-sans-medium text-sm ${type === t.value ? "text-white" : "text-ink"}`}>{t.label}</Text>
            </Pressable>
          ))}
        </View>}

        {type === "review" && (
          <View className="mb-4 flex-row gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setRating(n)} accessibilityRole="button" accessibilityLabel={`${n} stars`}>
                <Ionicons name={n <= rating ? "star" : "star-outline"} size={28} color={colors.amber} />
              </Pressable>
            ))}
          </View>
        )}

        <FormInput label="Subject" value={subject} onChangeText={setSubject} />
        <FormInput
          label="Your message"
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={5}
          style={{ minHeight: 120, textAlignVertical: "top" }}
        />

        <PrimaryButton label="Submit feedback" onPress={handleSubmit} loading={submitting} className="mt-2" />

        <Text className="mb-3 mt-8 font-display text-lg text-ink">Your feedback</Text>
        {loadingFeedback ? <StateView state="loading" /> : feedbackItems.length === 0 ? <StateView state="empty" title="No feedback yet" message="Your submissions and staff responses will appear here." /> : feedbackItems.map((item) => (
          <View key={item._id} className="mb-3 rounded-2xl border border-border bg-white p-4">
            <View className="mb-2 flex-row items-center justify-between"><Text className="font-sans-medium text-sm text-ink">{item.subject || item.type}</Text><StatusBadge status={item.status} /></View>
            <Text className="font-sans text-sm text-slate">{item.message}</Text>
            {!!item.adminResponse && <View className="mt-3 rounded-lg bg-mintBg p-3"><Text className="font-sans-medium text-xs text-ink">CarePaws response</Text><Text className="mt-1 font-sans text-sm text-slate">{item.adminResponse}</Text></View>}
            <Text className="mt-2 font-sans text-xs text-mutedLight">{new Date(item.createdAt).toLocaleString()}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
