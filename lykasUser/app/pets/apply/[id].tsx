import { useState } from "react";
import { View, Text, ScrollView, Pressable, Switch, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../../../utils/api";
import { isEmailNotVerifiedError } from "../../../utils/emailVerification";
import FormInput from "../../../components/FormInput";
import PrimaryButton from "../../../components/PrimaryButton";
import colors from "../../../utils/colors";

export default function ApplyToPetScreen() {
  const { id, type: typeParam } = useLocalSearchParams<{ id: string; type?: string }>();
  // Never trust the raw param: anything other than "foster" is an adoption.
  const type = typeParam === "foster" ? "foster" : "adoption";
  const isFoster = type === "foster";
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [experience, setExperience] = useState("");
  const [householdSize, setHouseholdSize] = useState("");
  const [isRenting, setIsRenting] = useState(false);
  const [landlordApproval, setLandlordApproval] = useState(false);
  const [fosterPeriod, setFosterPeriod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!phone || !address) {
      setError("Phone and address are required.");
      return;
    }
    if (isFoster && !fosterPeriod.trim()) {
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
        landlordApproval,
        type,
        ...(isFoster ? { fosterPeriod: fosterPeriod.trim() } : {}),
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

        {error && (
          <View className="mb-4 rounded-xl border border-status-danger/20 bg-status-dangerBg px-4 py-3">
            <Text className="font-sans text-sm text-status-danger">{error}</Text>
          </View>
        )}

        <FormInput label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="apply-phone" />
        <FormInput label="Home address" value={address} onChangeText={setAddress} testID="apply-address" />
        {isFoster && (
          <FormInput
            label="How long can you foster?"
            value={fosterPeriod}
            onChangeText={setFosterPeriod}
            placeholder="e.g. 4 weeks"
            testID="apply-foster-period"
          />
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

        <View className="mb-4 flex-row items-center justify-between rounded-xl border border-border bg-white px-4 py-3">
          <Text className="font-sans text-sm text-ink">I am renting my home</Text>
          <Switch
            value={isRenting}
            onValueChange={setIsRenting}
            trackColor={{ true: colors.primary, false: colors.border }}
            testID="apply-renting-switch"
          />
        </View>

        {isRenting && (
          <View className="mb-4 flex-row items-center justify-between rounded-xl border border-border bg-white px-4 py-3">
            <Text className="flex-1 pr-2 font-sans text-sm text-ink">My landlord has approved pet ownership</Text>
            <Switch value={landlordApproval} onValueChange={setLandlordApproval} trackColor={{ true: colors.primary, false: colors.border }} />
          </View>
        )}

        <PrimaryButton label={isFoster ? "Submit foster application" : "Submit application"} onPress={handleSubmit} loading={submitting} className="mt-2" testID="apply-submit" />
      </ScrollView>
    </SafeAreaView>
  );
}
