import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { subscribeToTripChat, ChatMessage } from "../services/chat";
import { api } from "../services/api";
import { useTranslation } from "../i18n/LocaleProvider";

export default function ChatScreen({
  tripId,
  ownerPhone,
}: {
  tripId: string;
  ownerPhone: string;
}) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    api
      .getTripMessages(tripId)
      .then(setMessages)
      .catch((err) => console.warn("[ChatScreen] failed to load history", err));

    const unsubscribe = subscribeToTripChat(tripId, (msg) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    });
    return unsubscribe;
  }, [tripId]);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft("");
    setSending(true);
    try {
      const sent = await api.sendTripMessage(tripId, body);
      // Optimistic append — the Realtime event for our own message will
      // also arrive and is de-duped by id in the subscription handler above.
      setMessages((prev) => [...prev, sent]);
    } catch (err) {
      Alert.alert("Couldn't send message", err instanceof Error ? err.message : "Try again.");
      setDraft(body); // restore so the driver doesn't lose what they typed
    } finally {
      setSending(false);
    }
  }, [draft, sending, tripId]);

  function handleCall() {
    Linking.openURL(`tel:${ownerPhone}`).catch(() =>
      Alert.alert("Couldn't start call", "This device can't place phone calls.")
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={80}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("chatScreen.title")}</Text>
        <TouchableOpacity style={styles.callButton} onPress={handleCall}>
          <Ionicons name="call" size={16} color="#fff" />
          <Text style={styles.callButtonText}>{t("chatScreen.callOwner")}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.senderRole === "DRIVER" ? styles.bubbleMine : styles.bubbleTheirs]}>
            <Text style={[styles.bubbleText, item.senderRole === "DRIVER" && styles.bubbleTextMine]}>
              {item.body}
            </Text>
          </View>
        )}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={t("chatScreen.placeholder")}
          placeholderTextColor="#9CA3AF"
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={sending || !draft.trim()}>
          <Ionicons name="send" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  headerTitle: { fontSize: 16, fontWeight: "700", color: "#111827" },
  callButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  callButtonText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  messageList: { padding: 16, gap: 8 },
  bubble: { maxWidth: "80%", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { backgroundColor: "#111827", alignSelf: "flex-end" },
  bubbleTheirs: { backgroundColor: "#fff", alignSelf: "flex-start", borderWidth: 1, borderColor: "#E5E7EB" },
  bubbleText: { fontSize: 14, color: "#111827" },
  bubbleTextMine: { color: "#fff" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    gap: 8,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
});
