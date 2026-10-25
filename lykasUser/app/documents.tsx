import { useCallback, useEffect, useState } from "react";
import { useRealtimeReload, useSilentFlag } from "../context/RealtimeContext";
import { View, Text, FlatList, Pressable, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { api, getApiErrorMessage } from "../utils/api";
import StateView from "../components/StateView";
import StatusBadge from "../components/StatusBadge";
import colors from "../utils/colors";

interface UserDocument {
  _id: string;
  type: string;
  label?: string;
  status: string;
  rejectedReason?: string;
  createdAt: string;
}

const DOC_TYPES = [
  { value: "government_id", label: "Government ID" },
  { value: "proof_of_address", label: "Proof of address" },
  { value: "proof_of_income", label: "Proof of income" },
  { value: "house_photo", label: "House photo" },
  { value: "pet_owner_agreement", label: "Pet owner agreement" },
];

export default function DocumentsScreen() {
  const { applicationId } = useLocalSearchParams<{ applicationId?: string }>();
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const live = useSilentFlag();

  const load = useCallback(async () => {
    const silent = live.take();
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await api.get("/api/documents/my");
      setDocuments(res.data.data);
    } catch (err) {
      if (!silent) setError(getApiErrorMessage(err, "Failed to load your documents"));
    } finally {
      setLoading(false);
    }
  }, [live]);

  useRealtimeReload(["UserDocument"], load, live);

  useEffect(() => {
    load();
  }, [load]);

  async function uploadDocument(type: string) {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setUploading(type);
    try {
      const formData = new FormData();
      formData.append("type", type);
      if (applicationId) formData.append("application", applicationId);
      formData.append("file", {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? "application/octet-stream",
      } as unknown as Blob);

      // Don't set Content-Type manually — axios/React Native needs to
      // compute it (including the multipart boundary) from the FormData
      // instance itself, or the server can't parse the body.
      await api.post("/api/documents", formData);
      load();
    } catch (err) {
      Alert.alert("Upload failed", getApiErrorMessage(err));
    } finally {
      setUploading(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="flex-row items-center gap-2 px-5 pb-3 pt-2">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <Text className="font-display text-xl text-ink">Documents</Text>
      </View>

      <View className="mb-4 px-5">
        <Text className="mb-2 font-sans-medium text-sm text-ink">Upload a document</Text>
        <View className="flex-row flex-wrap gap-2">
          {DOC_TYPES.map((t) => (
            <Pressable
              key={t.value}
              onPress={() => uploadDocument(t.value)}
              disabled={uploading === t.value}
              className="flex-row items-center gap-1.5 rounded-full border border-border bg-white px-3 py-2"
            >
              <Ionicons name="cloud-upload-outline" size={14} color={colors.primary} />
              <Text className="font-sans text-xs text-ink">{uploading === t.value ? "Uploading…" : t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={load} />
      ) : documents.length === 0 ? (
        <StateView state="empty" title="No documents uploaded yet" />
      ) : (
        <FlatList
          data={documents}
          keyExtractor={(d) => d._id}
          contentContainerClassName="px-5 pb-8 gap-2"
          renderItem={({ item }) => (
            <View className="rounded-xl border border-border bg-white px-4 py-3">
              <View className="flex-row items-center justify-between">
                <Text className="font-sans text-sm text-ink">{DOC_TYPES.find((t) => t.value === item.type)?.label ?? item.type}</Text>
                <StatusBadge status={item.status} />
              </View>
              {item.status === "rejected" && item.rejectedReason && (
                <Text className="mt-1.5 font-sans text-xs text-status-danger">{item.rejectedReason}</Text>
              )}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
