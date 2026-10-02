import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { supabase } from "../services/supabaseClient";

// First screen of the entire app now — replaces going straight to
// RegistrationScreen. A phone number must be verified via OTP before any
// registration or login can happen; Supabase creates the underlying
// auth.users row the first time a phone successfully verifies.
export default function PhoneEntryScreen({ onCodeSent }: { onCodeSent: (phone: string) => void }) {
  const [phone, setPhone] = useState("+994");
  const [sending, setSending] = useState(false);

  async function handleSendCode() {
    if (phone.trim().length < 8) {
      Alert.alert("Enter a valid phone number", "Include your country code, e.g. +994501234567.");
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: phone.trim() });
      if (error) throw error;
      onCodeSent(phone.trim());
    } catch (err) {
      Alert.alert(
        "Couldn't send code",
        err instanceof Error ? err.message : "Check your number and try again."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Dray</Text>
      <Text style={styles.subtitle}>Enter your phone number to sign in or create an account.</Text>

      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder="+994 50 123 45 67"
        placeholderTextColor="#9CA3AF"
        keyboardType="phone-pad"
        autoFocus
      />

      <TouchableOpacity style={styles.button} onPress={handleSendCode} disabled={sending}>
        {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send code</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB", justifyContent: "center", padding: 24 },
  title: { fontSize: 26, fontWeight: "700", color: "#111827", textAlign: "center" },
  subtitle: { fontSize: 14, color: "#6B7280", textAlign: "center", marginTop: 8, marginBottom: 28 },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    backgroundColor: "#fff",
    textAlign: "center",
  },
  button: { backgroundColor: "#111827", borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 20 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
