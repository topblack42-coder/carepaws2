import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../utils/api";
import { useAuth } from "../context/AuthContext";
import { isEmailNotVerifiedError, needsEmailVerification, promptVerifyEmail } from "../utils/emailVerification";
import FormInput from "../components/FormInput";
import PrimaryButton from "../components/PrimaryButton";
import colors from "../utils/colors";

const AVAILABILITY_OPTIONS = ["Weekday mornings", "Weekday afternoons", "Weekends", "Flexible"];

interface VolunteerProfile {
  phone?: string;
  address?: string;
  motivation?: string;
  availability?: string[];
  skills?: string[];
  status?: string;
}

export default function VolunteerPortalScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<VolunteerProfile | null>(null);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [motivation, setMotivation] = useState("");
  const [skills, setSkills] = useState("");
  const [availability, setAvailability] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);
    try {
      const res = await api.get("/api/volunteers/me");
      const data: VolunteerProfile = res.data.data;
      setProfile(data);
      setPhone(data.phone || "");
      setAddress(data.address || "");
      setMotivation(data.motivation || "");
      setSkills((data.skills || []).join(", "));
      setAvailability(data.availability || []);
    } catch (err: any) {
      // A 404 simply means the user has not registered yet.
      if (err?.response?.status !== 404) setError(getApiErrorMessage(err, "Failed to load volunteer profile"));
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  function toggleAvailability(opt: string) {
    setAvailability((prev) => (prev.includes(opt) ? prev.filter((a) => a !== opt) : [...prev, opt]));
  }

  async function handleSubmit() {
    if (!phone || !address) {
      setError("Phone and address are required.");
      return;
    }
    // Signing up as a volunteer requires a verified email (updating an existing profile does not).
    if (!profile && needsEmailVerification(user)) {
      promptVerifyEmail();
      return;
    }
    setError(null);
    setSubmitting(true);
    const payload = {
      phone,
      address,
      motivation,
      availability,
      skills: skills.split(",").map((skill) => skill.trim()).filter(Boolean),
    };

    try {
      if (profile) {
        const res = await api.put("/api/volunteers/me", payload);
        setProfile(res.data.data);
        Alert.alert("Profile updated", "Your volunteer details and availability have been saved.");
      } else {
        const res = await api.post("/api/volunteers/register", payload);
        setProfile(res.data.data);
        Alert.alert("Application submitted", "We'll review your application and get back to you.");
      }
    } catch (err) {
      // EMAIL_NOT_VERIFIED is shown as a prompt by the API client; skip the raw banner.
      if (!isEmailNotVerifiedError(err)) setError(getApiErrorMessage(err, profile ? "Failed to update your profile" : "Failed to submit your application"));
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
          <Text className="font-display text-xl text-ink">{profile ? "Volunteer profile" : "Become a volunteer"}</Text>
        </View>

        {error && (
          <View className="mb-4 rounded-xl border border-status-danger/20 bg-status-dangerBg px-4 py-3">
            <Text className="font-sans text-sm text-status-danger">{error}</Text>
          </View>
        )}

        {profile?.status && (
          <View className="mb-4 rounded-xl border border-border bg-white px-4 py-3">
            <Text className="font-sans-medium text-sm text-ink">Application status: {profile.status}</Text>
          </View>
        )}

        <FormInput label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <FormInput label="Address" value={address} onChangeText={setAddress} />
        <FormInput
          label="Why do you want to volunteer?"
          value={motivation}
          onChangeText={setMotivation}
          multiline
          numberOfLines={4}
          style={{ minHeight: 96, textAlignVertical: "top" }}
        />
        <FormInput
          label="Skills"
          value={skills}
          onChangeText={setSkills}
          placeholder="e.g. animal care, photography, event setup"
        />

        <Text className="mb-2 font-sans-medium text-sm text-ink">When are you available?</Text>
        <View className="mb-4 gap-2">
          {AVAILABILITY_OPTIONS.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => toggleAvailability(opt)}
              className={`flex-row items-center gap-2 rounded-xl border px-4 py-3 ${availability.includes(opt) ? "border-primary bg-mintBg" : "border-border bg-white"}`}
            >
              <Ionicons
                name={availability.includes(opt) ? "checkbox" : "square-outline"}
                size={18}
                color={availability.includes(opt) ? colors.primary : colors.mutedLight}
              />
              <Text className="font-sans text-sm text-ink">{opt}</Text>
            </Pressable>
          ))}
        </View>

        <PrimaryButton
          label={loadingProfile ? "Loading…" : profile ? "Save profile" : "Submit application"}
          onPress={handleSubmit}
          loading={submitting || loadingProfile}
          disabled={loadingProfile}
          className="mt-2"
        />
      </ScrollView>
    </SafeAreaView>
  );
}
