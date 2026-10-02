import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { supabase } from "../services/supabaseClient";

export default function OtpVerifyScreen({
  phone,
  onVerified,
  onBack,
}: {
  phone: string;
  onVerified: () => void; // App.tsx re-checks the session and moves on from here
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  async function handleVerify() {
    if (code.trim().length < 4) {
      Alert.alert("Enter the code", "Check the SMS you received.");
      return;
    }
    setVerifying(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone, token: code.trim(), type: "sms" });
      if (error) throw error;
      onVerified();
    } catch (err) {
      Alert.alert("Invalid code", err instanceof Error ? err.message : "Try again.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter the code</Text>
      <Text style={styles.subtitle}>We sent a code to {phone}.</Text>

      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        placeholder="123456"
        placeholderTextColor="#9CA3AF"
        keyboardType="number-pad"
        autoFocus
        maxLength={6}
      />

      <TouchableOpacity style={styles.button} onPress={handleVerify} disabled={verifying}>
        {verifying ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>Use a different number</Text>
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
    fontSize: 20,
    letterSpacing: 6,
    backgroundColor: "#fff",
    textAlign: "center",
  },
  button: { backgroundColor: "#111827", borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 20 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  backButton: { marginTop: 16, alignItems: "center" },
  backButtonText: { color: "#6B7280", fontSize: 14 },
});
