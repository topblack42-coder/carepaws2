import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../../../utils/api";
import { isEmailNotVerifiedError } from "../../../utils/emailVerification";
import { useAuth } from "../../../context/AuthContext";
import { formatMissingFields, getMissingProfileFields } from "../../../utils/profileCompleteness";
import FormInput from "../../../components/FormInput";
import PrimaryButton from "../../../components/PrimaryButton";
import colors from "../../../utils/colors";

// Matches the shelter's foster trial rules (30-60 days), so what the applicant
// offers is something staff can actually schedule.
const FOSTER_DAY_OPTIONS = [30, 45, 60] as const;

const PICKUP_DAYS_AHEAD = 14;
const PICKUP_METHODS = [
  { value: "Shelter pickup", label: "Pick up at shelter" },
  { value: "Home delivery", label: "Deliver to my home" },
] as const;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Next two weeks, starting tomorrow, as { iso: "YYYY-MM-DD", weekday, label }. */
function upcomingDays() {
  return Array.from({ length: PICKUP_DAYS_AHEAD }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return {
      iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
  });
}

export default function ApplyToPetScreen() {
  const { id, type: typeParam } = useLocalSearchParams<{ id: string; type?: string }>();
  // Never trust the raw param: anything other than "foster" is an adoption.
  const type = typeParam === "foster" ? "foster" : "adoption";
  const isFoster = type === "foster";
  const { user } = useAuth();
  // Phone, address and renting details live in Settings; the application reuses them.
  const phone = user?.phone?.trim() ?? "";
  const address = user?.address?.trim() ?? "";
  const isRenting = Boolean(user?.isRenting);
  const landlordProofUrl = user?.landlordProofUrl ?? null;
  const missingProfileFields = getMissingProfileFields(user);
  const [experience, setExperience] = useState("");
  const [householdSize, setHouseholdSize] = useState("");
  const [fosterDays, setFosterDays] = useState<number | null>(null);
  const [pickupDate, setPickupDate] = useState<string | null>(null);
  const [pickupMethod, setPickupMethod] = useState<(typeof PICKUP_METHODS)[number]["value"]>("Shelter pickup");
  const pickupOptions = useMemo(upcomingDays, []);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!phone || !address) {
      setError("Phone and address are required. Add them in Settings first.");
      return;
    }
    if (isRenting && !landlordProofUrl) {
      setError("You are renting, so please upload a photo of your landlord's approval in Settings first.");
      return;
    }
    if (isFoster && !fosterDays) {
      setError("Please tell us how long you can foster.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/applications", {
        pet: id,
        phone,
        address,
        experience,
        householdSize: householdSize ? Number(householdSize) : undefined,
        isRenting,
        landlordApproval: isRenting && Boolean(landlordProofUrl),
        type,
        ...(isFoster && fosterDays ? { fosterDays, fosterPeriod: `${fosterDays} days` } : {}),
        ...(isFoster && pickupDate ? { preferredPickupDate: pickupDate, preferredPickupMethod: pickupMethod } : {}),
      });
      Alert.alert("Application submitted", `We'll be in touch about your ${type} application.`, [
        { text: "OK", onPress: () => router.replace("/(tabs)/my-applications") },
      ]);
    } catch (err) {
      // EMAIL_NOT_VERIFIED is shown as a prompt by the API client; skip the raw banner.
      if (!isEmailNotVerifiedError(err)) setError(getApiErrorMessage(err, "Failed to submit your application"));
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
          <Text className="font-display text-xl text-ink">{isFoster ? "Foster application" : "Adoption application"}</Text>
        </View>

        {missingProfileFields.length > 0 && (
          <View className="mb-4 rounded-xl border border-status-warning/20 bg-status-warningBg px-4 py-3" testID="apply-complete-profile">
            <Text className="font-sans-medium text-sm text-ink">Complete your profile</Text>
            <Text className="mt-0.5 font-sans text-xs text-muted">
              Your profile has no {formatMissingFields(missingProfileFields)}. Save it once in Settings and it will be filled in for every application.
            </Text>
            <Pressable
              onPress={() => router.push("/(tabs)/settings")}
              accessibilityRole="button"
              accessibilityLabel="Open Settings to complete your profile"
              testID="apply-open-settings"
              className="mt-2 self-start"
            >
              <Text className="font-sans-medium text-sm text-primary">Go to Settings</Text>
            </Pressable>
          </View>
        )}

        {error && (
          <View className="mb-4 rounded-xl border border-status-danger/20 bg-status-dangerBg px-4 py-3">
            <Text className="font-sans text-sm text-status-danger">{error}</Text>
          </View>
        )}

        <View className="mb-4 rounded-xl border border-border bg-white px-4 py-3" testID="apply-profile-summary">
          <View className="flex-row items-center justify-between">
            <Text className="font-sans-medium text-sm text-ink">Your details</Text>
            <Pressable
              onPress={() => router.push("/(tabs)/settings")}
              accessibilityRole="button"
              accessibilityLabel="Edit your details in Settings"
              testID="apply-edit-settings"
            >
              <Text className="font-sans-medium text-sm text-primary">Edit in Settings</Text>
            </Pressable>
          </View>
          <Text className="mt-2 font-sans text-xs text-muted">Phone number</Text>
          <Text className="font-sans text-sm text-ink" testID="apply-phone">{phone || "Not added yet"}</Text>
          <Text className="mt-2 font-sans text-xs text-muted">Home address</Text>
          <Text className="font-sans text-sm text-ink" testID="apply-address">{address || "Not added yet"}</Text>
          <Text className="mt-2 font-sans text-xs text-muted">Housing</Text>
          <Text className="font-sans text-sm text-ink" testID="apply-housing">
            {isRenting ? (landlordProofUrl ? "Renting · landlord approval photo added" : "Renting · landlord approval photo missing") : "Not renting"}
          </Text>
        </View>
        {isFoster && (
          <View className="mb-4 gap-1.5" testID="apply-foster-period">
            <Text className="font-sans-medium text-sm text-ink">How long can you foster?</Text>
            <View className="flex-row gap-2">
              {FOSTER_DAY_OPTIONS.map((days) => {
                const selected = fosterDays === days;
                return (
                  <Pressable
                    key={days}
                    onPress={() => setFosterDays(days)}
                    testID={`apply-foster-${days}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${days} days`}
                    accessibilityState={{ selected }}
                    className={`flex-1 items-center rounded-xl border py-3 ${selected ? "border-primary bg-primary" : "border-border bg-white"}`}
                  >
                    <Text className={`font-sans-bold text-base ${selected ? "text-white" : "text-ink"}`}>{days}</Text>
                    <Text className={`font-sans text-xs ${selected ? "text-white" : "text-muted"}`}>days</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text className="font-sans text-xs text-muted">Foster trials run 30 to 60 days. The shelter confirms the final dates with you.</Text>
          </View>
        )}
        {isFoster && (
          <View className="mb-4 gap-1.5" testID="apply-pickup">
            <Text className="font-sans-medium text-sm text-ink">When would you like to get the pet? (optional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" keyboardShouldPersistTaps="handled">
              {pickupOptions.map((day) => {
                const selected = pickupDate === day.iso;
                return (
                  <Pressable
                    key={day.iso}
                    onPress={() => setPickupDate(selected ? null : day.iso)}
                    testID={`apply-pickup-${day.iso}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${day.weekday} ${day.label}`}
                    accessibilityState={{ selected }}
                    className={`w-16 items-center rounded-xl border py-2.5 ${selected ? "border-primary bg-primary" : "border-border bg-white"}`}
                  >
                    <Text className={`font-sans text-xs ${selected ? "text-white" : "text-muted"}`}>{day.weekday}</Text>
                    <Text className={`font-sans-bold text-sm ${selected ? "text-white" : "text-ink"}`}>{day.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {pickupDate && (
              <View className="mt-1 flex-row gap-2">
                {PICKUP_METHODS.map((m) => {
                  const selected = pickupMethod === m.value;
                  return (
                    <Pressable
                      key={m.value}
                      onPress={() => setPickupMethod(m.value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      className={`flex-1 items-center rounded-xl border py-2.5 ${selected ? "border-primary bg-mintBg" : "border-border bg-white"}`}
                    >
                      <Text className={`font-sans-medium text-sm ${selected ? "text-primary" : "text-ink"}`}>{m.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            <Text className="font-sans text-xs text-muted">This is just a request. The shelter will confirm the exact day and time, and your foster period starts when you receive the pet.</Text>
          </View>
        )}
        <FormInput label="Household size" value={householdSize} onChangeText={setHouseholdSize} keyboardType="number-pad" testID="apply-household" />
        <FormInput
          label={isFoster ? "Experience caring for pets (foster)" : "Pet ownership / handling experience"}
          value={experience}
          onChangeText={setExperience}
          multiline
          numberOfLines={4}
          style={{ minHeight: 96, textAlignVertical: "top" }}
          testID="apply-experience"
        />

        <PrimaryButton label={isFoster ? "Submit foster application" : "Submit application"} onPress={handleSubmit} loading={submitting} className="mt-2" testID="apply-submit" />
      </ScrollView>
    </SafeAreaView>
  );
}
