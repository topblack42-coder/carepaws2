import { useState } from "react";
import { View, Text, ScrollView, Switch, Alert, Pressable } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { api, getApiErrorMessage } from "../../utils/api";
import { registerForPushNotificationsAsync, unregisterPushNotifications } from "../../utils/pushNotifications";
import FormInput from "../../components/FormInput";
import PrimaryButton from "../../components/PrimaryButton";
import colors from "../../utils/colors";

export default function SettingsScreen() {
  const { user, refreshUser } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = useState(user?.notificationsEnabled ?? true);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [address, setAddress] = useState(user?.address ?? "");
  const [savingContact, setSavingContact] = useState(false);

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
          <Text className="mb-2 font-sans-medium text-base text-ink">Contact details</Text>
          <FormInput label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="settings-phone" />
          <FormInput label="Home address" value={address} onChangeText={setAddress} testID="settings-address" />
          <PrimaryButton label="Save contact details" onPress={saveContact} loading={savingContact} className="mt-2" testID="settings-save-contact" />
        </View>

        <View className="rounded-2xl border border-border bg-white p-4">
          <Text className="font-sans-medium text-base text-ink">Account</Text>
          <Text className="mt-1 font-sans text-xs text-muted">{user?.email}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
