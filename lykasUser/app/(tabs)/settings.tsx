import { useState } from "react";
import { View, Text, ScrollView, Switch, Alert, Pressable, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { api, getApiErrorMessage } from "../../utils/api";
import { registerForPushNotificationsAsync, unregisterPushNotifications } from "../../utils/pushNotifications";
import FormInput from "../../components/FormInput";
import PrimaryButton from "../../components/PrimaryButton";
import colors from "../../utils/colors";
import { formatMissingFields, getMissingProfileFields } from "../../utils/profileCompleteness";

export default function SettingsScreen() {
  const { user, refreshUser } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = useState(user?.notificationsEnabled ?? true);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [address, setAddress] = useState(user?.address ?? "");
  const [savingContact, setSavingContact] = useState(false);
  const [isRenting, setIsRenting] = useState(user?.isRenting ?? false);
  const [proofUrl, setProofUrl] = useState(user?.landlordProofUrl ?? null);
  const [housingBusy, setHousingBusy] = useState(false);
  // Based on what is saved on the account, not on what is typed but unsaved.
  const missingFields = getMissingProfileFields(user);

  async function saveContact() {
    setSavingContact(true);
    try {
      await api.put("/api/auth/profile", { phone: phone.trim(), address: address.trim() });
      await refreshUser();
      Alert.alert("Saved", "Your contact details were updated.");
    } catch (err) {
      Alert.alert("Something went wrong", getApiErrorMessage(err));
    } finally {
      setSavingContact(false);
    }
  }

  async function toggleRenting(value: boolean) {
    setHousingBusy(true);
    setIsRenting(value);
    try {
      await api.put("/api/auth/profile", { isRenting: value });
      // The server clears the landlord photo when you stop renting.
      if (!value) setProofUrl(null);
      await refreshUser();
    } catch (err) {
      Alert.alert("Something went wrong", getApiErrorMessage(err));
      setIsRenting(!value);
    } finally {
      setHousingBusy(false);
    }
  }

  async function pickLandlordProof() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to upload your landlord's approval.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setHousingBusy(true);
    try {
      const formData = new FormData();
      formData.append("image", {
        uri: asset.uri,
        name: asset.fileName ?? "landlord-approval.jpg",
        type: asset.mimeType ?? "image/jpeg",
      } as unknown as Blob);
      // No manual Content-Type: React Native adds the multipart boundary itself.
      const res = await api.post("/api/auth/landlord-proof", formData);
      setProofUrl(res.data?.data?.landlordProofUrl ?? asset.uri);
      await refreshUser();
    } catch (err) {
      Alert.alert("Upload failed", getApiErrorMessage(err));
    } finally {
      setHousingBusy(false);
    }
  }

  async function removeLandlordProof() {
    setHousingBusy(true);
    try {
      await api.delete("/api/auth/landlord-proof");
      setProofUrl(null);
      await refreshUser();
    } catch (err) {
      Alert.alert("Something went wrong", getApiErrorMessage(err));
    } finally {
      setHousingBusy(false);
    }
  }

  async function toggleNotifications(value: boolean) {
    setBusy(true);
    setNotificationsEnabled(value);
    try {
      if (value) {
        const token = await registerForPushNotificationsAsync();
        if (!token) {
          Alert.alert(
            "Permission needed",
            "Enable notifications for CarePaws in your device settings to receive push alerts."
          );
          setNotificationsEnabled(false);
          return;
        }
        await api.put("/api/auth/profile", { notificationsEnabled: true });
      } else {
        await unregisterPushNotifications();
      }
      await refreshUser();
    } catch (err) {
      Alert.alert("Something went wrong", getApiErrorMessage(err));
      setNotificationsEnabled(!value);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView contentContainerClassName="px-5 pb-8 pt-2">
        <View className="mb-4 flex-row items-center gap-2">
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
          <Text className="font-display text-xl text-ink">Settings</Text>
        </View>

        {missingFields.length > 0 && (
          <View className="mb-6 flex-row gap-3 rounded-2xl border border-status-warning/20 bg-status-warningBg p-4" testID="settings-complete-profile">
            <Ionicons name="alert-circle-outline" size={20} color={colors.warnBrown} />
            <View className="flex-1">
              <Text className="font-sans-medium text-sm text-ink">Complete your profile</Text>
              <Text className="mt-0.5 font-sans text-xs text-muted">
                Add your {formatMissingFields(missingFields)} below. Shelter staff use these details to review your adoption and foster applications, and we will fill them in for you when you apply.
              </Text>
            </View>
          </View>
        )}

        <View className="mb-6 rounded-2xl border border-border bg-white p-4">
          <View className="flex-row items-center justify-between py-2">
            <View className="flex-1 pr-4">
              <Text className="font-sans-medium text-base text-ink">Push notifications</Text>
              <Text className="font-sans text-xs text-muted">Get alerts about your applications, chat messages, and reminders.</Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={toggleNotifications}
              disabled={busy}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        </View>

        <View className="mb-6 rounded-2xl border border-border bg-white p-4">
          <Text className="font-sans-medium text-base text-ink">Contact details</Text>
          <Text className="mb-3 mt-0.5 font-sans text-xs text-muted">Shared with the shelter when you apply to adopt or foster.</Text>
          <FormInput label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="settings-phone" />
          <FormInput label="Home address" value={address} onChangeText={setAddress} testID="settings-address" />
          <PrimaryButton label="Save contact details" onPress={saveContact} loading={savingContact} className="mt-2" testID="settings-save-contact" />
        </View>

        <View className="mb-6 rounded-2xl border border-border bg-white p-4" testID="settings-housing">
          <Text className="font-sans-medium text-base text-ink">Housing</Text>
          <Text className="mb-1 mt-0.5 font-sans text-xs text-muted">Shared with the shelter when you apply to adopt or foster.</Text>
          <View className="flex-row items-center justify-between py-2">
            <Text className="flex-1 pr-4 font-sans text-sm text-ink">I am renting my home</Text>
            <Switch
              value={isRenting}
              onValueChange={toggleRenting}
              disabled={housingBusy}
              trackColor={{ true: colors.primary, false: colors.border }}
              testID="settings-renting-switch"
            />
          </View>

          {isRenting && (
            <View className="mt-2 gap-2" testID="settings-landlord-proof">
              <Text className="font-sans-medium text-sm text-ink">Landlord approval for pets</Text>
              <Text className="font-sans text-xs text-muted">
                Upload a photo of your landlord&apos;s written OK (a letter, lease page, or message) so the shelter can check it.
              </Text>
              {proofUrl ? (
                <View className="gap-2">
                  <Image source={{ uri: proofUrl }} accessibilityLabel="Landlord approval photo" className="h-48 w-full rounded-xl bg-cream" resizeMode="cover" testID="settings-proof-image" />
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={pickLandlordProof}
                      disabled={housingBusy}
                      accessibilityRole="button"
                      className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-border bg-white py-2.5"
                    >
                      <Ionicons name="swap-horizontal-outline" size={16} color={colors.primary} />
                      <Text className="font-sans-medium text-sm text-ink">Replace</Text>
                    </Pressable>
                    <Pressable
                      onPress={removeLandlordProof}
                      disabled={housingBusy}
                      accessibilityRole="button"
                      testID="settings-proof-remove"
                      className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-border bg-white py-2.5"
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.primary} />
                      <Text className="font-sans-medium text-sm text-ink">Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={pickLandlordProof}
                  disabled={housingBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Upload landlord approval photo"
                  testID="settings-proof-upload"
                  className="flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-primary bg-white py-4"
                >
                  <Ionicons name="cloud-upload-outline" size={18} color={colors.primary} />
                  <Text className="font-sans-medium text-sm text-primary">{housingBusy ? "Uploading…" : "Upload photo"}</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        <View className="rounded-2xl border border-border bg-white p-4">
          <Text className="font-sans-medium text-base text-ink">Account</Text>
          <Text className="mt-1 font-sans text-xs text-muted">{user?.email}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
