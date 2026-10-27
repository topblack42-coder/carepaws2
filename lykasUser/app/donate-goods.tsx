import { useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, Image } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api, getApiErrorMessage } from "../utils/api";
import FormInput from "../components/FormInput";
import PrimaryButton from "../components/PrimaryButton";
import ConsentCheckbox from "../components/ConsentCheckbox";
import colors from "../utils/colors";

const DROP_OFF_OPTIONS = [
  { value: "walk_in", label: "Walk-in" },
  { value: "schedule", label: "Schedule pickup" },
  { value: "courier", label: "Courier" },
] as const;

export default function DonateGoodsScreen() {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [dropOff, setDropOff] = useState<(typeof DROP_OFF_OPTIONS)[number]["value"]>("walk_in");
  const [notes, setNotes] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const needsAddress = dropOff !== "walk_in";

  const picking = useRef(false);

  async function pickPhotos() {
    if (picking.current) return;
    picking.current = true;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission needed", "Allow photo library access to attach photos of your donation.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: 5,
        quality: 0.8,
      });
      if (!result.canceled) setPhotos(result.assets.slice(0, 5));
    } catch {
      Alert.alert("Couldn't open photos", "Something went wrong while opening your photo library. Please try again.");
    } finally {
      picking.current = false;
    }
  }

  async function handleSubmit() {
    if (!name) {
      setError("Please describe what you're donating.");
      return;
    }
    if (needsAddress && !pickupAddress.trim()) {
      setError("Please enter the pickup address so we know where to collect your donation.");
      return;
    }
    if (!accepted) {
      setError("Please agree to the Privacy Policy and User Agreement to continue.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("name", name);
      if (quantity) formData.append("quantity", quantity);
      if (unit) formData.append("unit", unit);
      formData.append("dropOff", dropOff);
      if (notes) formData.append("notes", notes);
      if (needsAddress) formData.append("pickupAddress", pickupAddress.trim());
      formData.append("acceptedTerms", String(accepted));
      photos.forEach((photo, index) =>
        formData.append("photos", { uri: photo.uri, name: photo.fileName ?? `donation-${index + 1}.jpg`, type: photo.mimeType ?? "image/jpeg" } as unknown as Blob)
      );
      // Don't set Content-Type manually — React Native computes the multipart boundary.
      await api.post("/api/donations/goods", formData);
      Alert.alert("Thank you!", "The shelter will follow up on your donation.", [{ text: "OK", onPress: () => router.back() }]);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to submit your donation"));
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
          <Text className="font-display text-xl text-ink">Donate goods</Text>
        </View>

        <Text className="mb-4 font-sans text-sm text-muted">
          Dog and cat food, bedding, cleaning supplies, and more make a real difference.
        </Text>

        {error && (
          <View className="mb-4 rounded-xl border border-status-danger/20 bg-status-dangerBg px-4 py-3">
            <Text className="font-sans text-sm text-status-danger">{error}</Text>
          </View>
        )}

        <FormInput label="What are you donating?" value={name} onChangeText={setName} placeholder="e.g. Dog food, blankets" />
        <View className="flex-row gap-3">
          <View className="flex-1">
            <FormInput label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
          </View>
          <View className="flex-1">
            <FormInput label="Unit" value={unit} onChangeText={setUnit} placeholder="e.g. kg, bags" />
          </View>
        </View>

        <Text className="mb-2 font-sans-medium text-sm text-ink">How will you get it to us?</Text>
        <View className="mb-4 gap-2">
          {DROP_OFF_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => setDropOff(opt.value)}
              className={`flex-row items-center gap-2 rounded-xl border px-4 py-3 ${dropOff === opt.value ? "border-primary bg-mintBg" : "border-border bg-white"}`}
            >
              <Ionicons
                name={dropOff === opt.value ? "radio-button-on" : "radio-button-off"}
                size={18}
                color={dropOff === opt.value ? colors.primary : colors.mutedLight}
              />
              <Text className="font-sans text-sm text-ink">{opt.label}</Text>
            </Pressable>
          ))}
        </View>

        {needsAddress && (
          <FormInput
            label="Pickup address"
            value={pickupAddress}
            onChangeText={setPickupAddress}
            placeholder="House no., street, barangay, city"
            multiline
            numberOfLines={2}
            style={{ minHeight: 56, textAlignVertical: "top" }}
            testID="goods-pickup-address"
          />
        )}

        <Pressable onPress={pickPhotos} accessibilityRole="button" className="mb-3 flex-row items-center gap-2 rounded-xl border border-border bg-white px-4 py-3">
          <Ionicons name="camera-outline" size={20} color={colors.primary} />
          <Text className="font-sans-medium text-sm text-ink">Attach photos of the items ({photos.length}/5)</Text>
        </Pressable>
        {photos.length > 0 && (
          <ScrollView horizontal className="mb-3">
            {photos.map((p) => (
              <Image key={p.assetId ?? p.uri} source={{ uri: p.uri }} className="mr-2 h-20 w-20 rounded-xl" />
            ))}
          </ScrollView>
        )}

        <FormInput label="Notes (optional)" value={notes} onChangeText={setNotes} multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: "top" }} />

        <ConsentCheckbox checked={accepted} onChange={setAccepted} testID="goods-consent" />

        <PrimaryButton label="Submit donation" onPress={handleSubmit} loading={submitting} disabled={!accepted} className="mt-2" />
      </ScrollView>
    </SafeAreaView>
  );
}
