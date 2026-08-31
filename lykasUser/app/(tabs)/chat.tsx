import { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, FlatList, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { io, type Socket } from "socket.io-client";
import { Ionicons } from "@expo/vector-icons";
import { api, tokenStore, getApiErrorMessage } from "../../utils/api";
import { useAuth } from "../../context/AuthContext";
import ChatMessage, { type ChatMessageData } from "../../components/ChatMessage";
import StateView from "../../components/StateView";
import colors from "../../utils/colors";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:5000";

/**
 * Merges freshly-fetched REST history with whatever's already in state
 * (which may include messages that arrived live via Socket.io before —
 * or while — the REST fetch was in flight), deduping by _id and
 * re-sorting by createdAt. Extracted as a standalone function so it's
 * directly unit-testable (§11.2 — this exact race is called out as
 * worth testing) independent of the socket/network plumbing around it.
 */
export function mergeMessages(existing: ChatMessageData[], incoming: ChatMessageData[]): ChatMessageData[] {
  const byId = new Map<string, ChatMessageData>();
  for (const m of existing) byId.set(m._id, m);
  for (const m of incoming) byId.set(m._id, m); // incoming wins on conflict — it's the source of truth for its own ids
  return Array.from(byId.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export default function ChatScreen() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<FlatList<ChatMessageData> | null>(null);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const res = await api.get(`/api/messages/${user.id}`);
      setMessages((prev: ChatMessageData[]) => mergeMessages(prev, res.data.data));
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load chat history"));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      const token = await tokenStore.getAccessToken();
      if (!token || cancelled) return;

      const socket = io(API_URL, { auth: { token } });
      socketRef.current = socket;

      socket.on("connect", () => {
        setConnected(true);
        loadHistory();
      });
      socket.on("disconnect", () => setConnected(false));
      socket.on("connect_error", () => setConnected(false));

      socket.on("receiveMessage", (message: ChatMessageData & { userId: string }) => {
        if (message.userId !== user.id) return; // not this conversation
        setMessages((prev: ChatMessageData[]) => mergeMessages(prev, [message]));
      });
    })();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
    };
  }, [user, loadHistory]);

  useEffect(() => {
    if (!user || messages.length === 0) return;
    api.put(`/api/messages/${user.id}/read`).catch(() => {});
  }, [messages.length, user]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  function send() {
    if (!draft.trim() || !user || !socketRef.current || !connected) return;
    const text = draft.trim();
    socketRef.current.emit("sendMessage", { userId: user.id, text }, (ack: { success?: boolean; message?: string }) => {
      if (!ack?.success) setError(ack?.message || "Failed to send message");
    });
    setDraft("");
  }

  if (loading) return <StateView state="loading" message="Loading conversation…" />;

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="flex-row items-center justify-between border-b border-border px-5 py-3">
        <Text className="font-display text-lg text-ink">Chat with the shelter</Text>
        <View className={`h-2 w-2 rounded-full ${connected ? "bg-status-success" : "bg-mutedLight"}`} accessibilityLabel={connected ? "Connected" : "Reconnecting"} />
      </View>

      {/*
        Android's default windowSoftInputMode is "adjustResize" (not
        overridden in app.json), which already shrinks the window to
        make room for the keyboard. Also passing behavior="height" here
        made KeyboardAvoidingView shrink this view a second time on top
        of that — the input row ended up pushed below the visible
        viewport the instant the keyboard opened, only reappearing once
        it closed. undefined on Android means "let the OS's own resize
        handle it," which is correct given adjustResize is active; iOS
        has no equivalent OS behavior, so it still needs "padding".
      */}
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View className="flex-1">
          {error ? (
            <StateView state="error" message={error} onRetry={loadHistory} />
          ) : messages.length === 0 ? (
            <StateView state="empty" title="No messages yet" message="Say hello — shelter staff typically respond within a day." />
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m._id}
              className="flex-1"
              contentContainerClassName="px-5 py-4"
              renderItem={({ item }: { item: ChatMessageData }) => <ChatMessage message={item} isOwn={item.sender === "user"} />}
            />
          )}
        </View>

        <View className="flex-row items-center gap-2 border-t border-border px-4 py-3">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message…"
            placeholderTextColor={colors.mutedLight}
            className="flex-1 rounded-full border border-border bg-white px-4 py-2.5 font-sans text-sm text-ink"
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <Pressable onPress={send} accessibilityRole="button" accessibilityLabel="Send message" className="rounded-full bg-primary p-3">
            <Ionicons name="send" size={16} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}