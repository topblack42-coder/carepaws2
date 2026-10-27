import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../utils/api";
import colors from "../utils/colors";
import StarRating from "./StarRating";

const RATING_LABELS = ["Tap a star to rate", "Poor", "Fair", "Good", "Very good", "Excellent"];
const MIN_LENGTH = 10;
const MAX_LENGTH = 1000;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called after a successful submit so the caller can refresh. */
  onSubmitted: () => void;
}

/** Bottom sheet for writing a shelter/adoption review. Reviews are moderated before they go live. */
export default function WriteReviewSheet({ visible, onClose, onSubmitted }: Props) {
  const [rating, setRating] = useState(0);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Start fresh every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setRating(0);
      setSubject("");
      setMessage("");
      setError(null);
      setDone(false);
    }
  }, [visible]);

  const trimmed = message.trim();
  const canSubmit = rating > 0 && trimmed.length >= MIN_LENGTH && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/feedback", {
        type: "review",
        rating,
        subject: subject.trim() || undefined,
        message: trimmed,
      });
      setDone(true);
      onSubmitted();
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't submit your review. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end">
        <Pressable onPress={onClose} accessibilityLabel="Close" className="absolute inset-0 bg-black/40" />
        <View className="max-h-[88%] rounded-t-3xl bg-cream px-5 pb-8 pt-3">
          <View className="mb-3 h-1 w-10 self-center rounded-full bg-gray300" />

          {done ? (
            <View className="items-center py-8" testID="review-success">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-mintBg">
                <Ionicons name="checkmark" size={34} color={colors.primary} />
              </View>
              <Text className="mt-4 font-display text-xl text-ink">Thank you!</Text>
              <Text className="mt-2 text-center font-sans text-sm leading-5 text-muted">
                The CarePaws team checks every review before it's shown to other adopters. We'll let you know once it's live.
              </Text>
              <Pressable onPress={onClose} accessibilityRole="button" className="mt-6 w-full items-center rounded-xl bg-primary py-3.5">
                <Text className="font-sans-bold text-base text-white">Done</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View className="mb-1 flex-row items-center justify-between">
                <Text className="font-display text-xl text-ink">Share your experience</Text>
                <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" className="h-9 w-9 items-center justify-center">
                  <Ionicons name="close" size={22} color={colors.muted} />
                </Pressable>
              </View>
              <Text className="mb-4 font-sans text-sm text-muted">Your words help other adopters decide with confidence.</Text>

              <View className="mb-5 items-center rounded-2xl border border-border bg-white py-4">
                <StarRating value={rating} size={36} onChange={setRating} />
                <Text className={`mt-2 font-sans-medium text-sm ${rating ? "text-primary" : "text-mutedLight"}`}>{RATING_LABELS[rating]}</Text>
              </View>

              <Text className="mb-1.5 font-sans-medium text-sm text-ink">Title (optional)</Text>
              <TextInput
                value={subject}
                onChangeText={setSubject}
                maxLength={100}
                placeholder="Sum it up in a few words"
                placeholderTextColor={colors.mutedLight}
                className="mb-4 rounded-xl border border-border bg-white px-4 py-3 font-sans text-base text-ink"
              />

              <Text className="mb-1.5 font-sans-medium text-sm text-ink">Your review</Text>
              <TextInput
                value={message}
                onChangeText={setMessage}
                maxLength={MAX_LENGTH}
                multiline
                placeholder="How was the adoption process? How did the team care for you and your pet?"
                placeholderTextColor={colors.mutedLight}
                style={{ minHeight: 120, textAlignVertical: "top" }}
                className="rounded-xl border border-border bg-white px-4 py-3 font-sans text-base text-ink"
              />
              <View className="mb-4 mt-1 flex-row justify-between">
                <Text className="font-sans text-xs text-mutedLight">{trimmed.length < MIN_LENGTH ? `At least ${MIN_LENGTH} characters` : " "}</Text>
                <Text className="font-sans text-xs text-mutedLight">
                  {message.length}/{MAX_LENGTH}
                </Text>
              </View>

              {error && (
                <View className="mb-3 rounded-xl border border-status-danger/20 bg-status-dangerBg px-4 py-3">
                  <Text className="font-sans text-sm text-status-danger">{error}</Text>
                </View>
              )}

              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit }}
                className={`flex-row items-center justify-center rounded-xl bg-primary px-5 py-3.5 ${canSubmit ? "" : "opacity-50"}`}
              >
                {submitting && <ActivityIndicator color={colors.white} className="mr-2" />}
                <Text className="font-sans-bold text-base text-white">Submit review</Text>
              </Pressable>
              <Text className="mt-3 text-center font-sans text-xs text-mutedLight">Reviews are checked by our team before they appear.</Text>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
