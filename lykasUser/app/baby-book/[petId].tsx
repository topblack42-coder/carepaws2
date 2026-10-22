import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, Modal, Alert, Image } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api, getApiErrorMessage } from "../../utils/api";
import { formatDate } from "../../utils/format";
import StateView from "../../components/StateView";
import PrimaryButton from "../../components/PrimaryButton";
import FormInput from "../../components/FormInput";
import colors from "../../utils/colors";

interface BabyBookEntry {
  _id: string;
  title: string;
  content?: string;
  category: string;
  date: string;
  photoUrl?: string | null;
}

const CATEGORIES = ["Milestone", "Health", "Funny Moment", "Training", "First Time", "General"];

export default function BabyBookScreen() {
  const { petId } = useLocalSearchParams<{ petId: string }>();
  const [entries, setEntries] = useState<BabyBookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("General");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!petId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/baby-book/${petId}`);
      setEntries(res.data.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load the baby book"));
    } finally {
      setLoading(false);
    }
  }, [petId]);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setEditingId(null);
    setTitle("");
    setContent("");
    setCategory("General");
    setPhoto(null);
    setExistingPhotoUrl(null);
    setSaveError(null);
    setFormVisible(true);
  }

  function openEdit(entry: BabyBookEntry) {
    setEditingId(entry._id);
    setTitle(entry.title);
    setContent(entry.content ?? "");
    setCategory(entry.category);
    setPhoto(null);
    setExistingPhotoUrl(entry.photoUrl ?? null);
    setSaveError(null);
    setFormVisible(true);
  }

  function closeForm() {
    setFormVisible(false);
    setEditingId(null);
    setPhoto(null);
    setExistingPhotoUrl(null);
    setSaveError(null);
  }

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to add a picture to this entry.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      setPhoto(result.assets[0]);
    }
  }

  async function handleSave() {
    if (!title) return;
    setSaving(true);
    setSaveError(null);
    try {
      const formData = new FormData();
      formData.append("title", title);
      // When editing, always send content (even empty) so Details can be cleared.
      if (content || editingId) formData.append("content", content);
      formData.append("category", category);
      if (photo) {
        formData.append("photo", {
          uri: photo.uri,
          name: photo.fileName ?? "photo.jpg",
          type: photo.mimeType ?? "image/jpeg",
        } as unknown as Blob);
      }

      if (editingId) {
        // Don't set Content-Type manually — axios/React Native needs to
        // compute it (including the multipart boundary) from the
        // FormData instance itself, or the server can't parse the body.
        await api.put(`/api/baby-book/entry/${editingId}`, formData);
      } else {
        formData.append("pet", petId ?? "");
        await api.post("/api/baby-book", formData);
      }
      closeForm();
      load();
    } catch (err) {
      setSaveError(getApiErrorMessage(err, "Failed to save entry"));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!editingId) return;
    const id = editingId;
    Alert.alert("Delete this entry?", "This can't be undone.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await api.delete(`/api/baby-book/entry/${id}`);
            closeForm();
            load();
          } catch (err) {
            Alert.alert("Couldn't delete", getApiErrorMessage(err));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
        <View className="flex-row items-center gap-2">
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
          <Text className="font-display text-xl text-ink">Baby book</Text>
        </View>
        <Pressable onPress={openAdd} accessibilityRole="button" accessibilityLabel="Add entry">
          <Ionicons name="add-circle" size={26} color={colors.primary} />
        </Pressable>
      </View>

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={load} />
      ) : entries.length === 0 ? (
        <StateView state="empty" title="No entries yet" message="Add your first milestone or funny moment." />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e._id}
          contentContainerClassName="px-5 pb-8 gap-3"
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openEdit(item)}
              accessibilityRole="button"
              accessibilityLabel={`Edit entry: ${item.title}`}
              className="rounded-2xl border border-border bg-white p-4"
            >
              {item.photoUrl && (
                <Image source={{ uri: item.photoUrl }} className="mb-3 h-40 w-full rounded-xl" resizeMode="cover" />
              )}
              <View className="mb-1 flex-row items-center justify-between">
                <Text className="font-sans-medium text-base text-ink" numberOfLines={1}>
                  {item.title}
                </Text>
                <View className="rounded-full bg-blush px-2.5 py-0.5">
                  <Text className="font-sans text-xs text-accentOrange">{item.category}</Text>
                </View>
              </View>
              <Text className="mb-1 font-sans text-xs text-muted">{formatDate(item.date)}</Text>
              {item.content && <Text className="font-sans text-sm text-slate">{item.content}</Text>}
            </Pressable>
          )}
        />
      )}

      <Modal visible={formVisible} animationType="slide" transparent onRequestClose={closeForm}>
        <View className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-3xl bg-cream p-5">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="font-display text-lg text-ink">{editingId ? "Edit entry" : "New baby book entry"}</Text>
              {editingId && (
                <Pressable
                  onPress={confirmDelete}
                  disabled={deleting}
                  accessibilityRole="button"
                  accessibilityLabel="Delete entry"
                  className="p-1"
                >
                  <Ionicons name="trash-outline" size={20} color={colors.status.danger} />
                </Pressable>
              )}
            </View>
            {saveError && (
              <View className="mb-4 rounded-xl border border-status-danger/20 bg-status-dangerBg px-4 py-3">
                <Text className="font-sans text-sm text-status-danger">{saveError}</Text>
              </View>
            )}
            <FormInput label="Title" value={title} onChangeText={setTitle} />
            <FormInput
              label="Details"
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={3}
              style={{ minHeight: 72, textAlignVertical: "top" }}
            />

            <View className="mb-4">
              <Text className="mb-1.5 font-sans-medium text-xs text-ink">Photo</Text>
              {photo || existingPhotoUrl ? (
                <View className="mb-2">
                  <Image
                    source={{ uri: photo ? photo.uri : existingPhotoUrl! }}
                    className="h-32 w-full rounded-xl"
                    resizeMode="cover"
                  />
                </View>
              ) : null}
              <Pressable
                onPress={pickPhoto}
                accessibilityRole="button"
                accessibilityLabel="Choose photo"
                className="flex-row items-center gap-1.5 self-start rounded-full border border-border bg-white px-3 py-2"
              >
                <Ionicons name="image-outline" size={14} color={colors.primary} />
                <Text className="font-sans text-xs text-ink">
                  {photo || existingPhotoUrl ? "Replace photo" : "Add a photo"}
                </Text>
              </Pressable>
            </View>

            <View className="mb-4 flex-row flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  className={`rounded-full border px-3 py-1.5 ${category === c ? "border-primary bg-primary" : "border-border bg-white"}`}
                >
                  <Text className={`font-sans text-xs ${category === c ? "text-white" : "text-ink"}`}>{c}</Text>
                </Pressable>
              ))}
            </View>
            <View className="flex-row gap-3">
              <PrimaryButton label="Cancel" variant="outline" onPress={closeForm} className="flex-1" />
              <PrimaryButton label="Save" onPress={handleSave} loading={saving} className="flex-1" />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
