import { useState } from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../../../utils/api";
import { useAuth } from "../../../context/AuthContext";
import { isEmailNotVerifiedError, needsEmailVerification, promptVerifyEmail } from "../../../utils/emailVerification";
import FormInput from "../../../components/FormInput";
import PrimaryButton from "../../../components/PrimaryButton";
import colors from "../../../utils/colors";

export default function ApplyToAppointmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [phone, setPhone] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!phone) {
      setError("Phone number is required.");
      return;
    }
    if (needsEmailVerification(user)) {
      promptVerifyEmail();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/api/appointments/${id}/enroll`, { phone, emergencyContact, notes });
      Alert.alert("You're enrolled", "See you then!", [{ text: "OK", onPress: () => router.replace("/my-appointments") }]);
    } catch (err) {
      // EMAIL_NOT_VERIFIED is shown as a prompt by the API client; skip the raw banner.
      if (!isEmailNotVerifiedError(err)) setError(getApiErrorMessage(err, "Failed to enroll in this appointment"));
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
          <Text className="font-display text-xl text-ink">Enroll in appointment</Text>
        </View>

        {error && (
          <View className="mb-4 rounded-xl border border-status-danger/20 bg-status-dangerBg px-4 py-3">
            <Text className="font-sans text-sm text-status-danger">{error}</Text>
          </View>
        )}

        <FormInput label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <FormInput label="Emergency contact" value={emergencyContact} onChangeText={setEmergencyContact} />
        <FormInput label="Notes (optional)" value={notes} onChangeText={setNotes} multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: "top" }} />

        <PrimaryButton label="Confirm enrollment" onPress={handleSubmit} loading={submitting} className="mt-2" />
      </ScrollView>
    </SafeAreaView>
  );
}
