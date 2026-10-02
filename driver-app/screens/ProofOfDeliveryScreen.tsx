import React, { useState } from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { api } from "../services/api";
import { useTranslation } from "../i18n/LocaleProvider";

/**
 * Uploads the POD photo directly to object storage (Supabase Storage / S3)
 * from the client, then hands the resulting URL to /trips/:id/pod — the
 * backend never touches raw image bytes. Swap the body of this function
 * for your storage provider's SDK; left as a clearly-marked stub since it's
 * infra-specific (bucket, signed URL policy, etc.) rather than app logic.
 */
async function uploadPhotoToStorage(localUri: string): Promise<string> {
  // Example with Supabase Storage:
  //
  //   const file = await fetch(localUri).then((r) => r.blob());
  //   const path = `pod/${Date.now()}.jpg`;
  //   const { error } = await supabase.storage.from("proof-of-delivery").upload(path, file);
  //   if (error) throw error;
  //   return supabase.storage.from("proof-of-delivery").getPublicUrl(path).data.publicUrl;
  //
  throw new Error("uploadPhotoToStorage() is a stub — wire up your storage provider here.");
}

export default function ProofOfDeliveryScreen({
  tripId,
  onSubmitted,
}: {
  tripId: string;
  onSubmitted: () => void;
}) {
  const { t } = useTranslation();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera access needed", "Enable camera access to submit proof of delivery.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  async function handleSubmit() {
    if (!photoUri) {
      Alert.alert("Photo required", t("pod.photoRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const photoUrl = await uploadPhotoToStorage(photoUri);
      await api.submitProofOfDelivery(tripId, photoUrl, notes || undefined);
      onSubmitted();
    } catch (err) {
      Alert.alert(
        "Couldn't submit proof of delivery",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("pod.title")}</Text>
      <Text style={styles.subtitle}>{t("pod.subtitle")}</Text>

      <TouchableOpacity style={styles.photoBox} onPress={takePhoto}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.photo} />
        ) : (
          <Text style={styles.photoBoxText}>{t("pod.tapToTakePhoto")}</Text>
        )}
      </TouchableOpacity>

      <TextInput
        style={styles.notesInput}
        placeholder={t("pod.notesPlaceholder")}
        placeholderTextColor="#9CA3AF"
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <TouchableOpacity
        style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{t("pod.submitButton")}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB", padding: 20, justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 13, color: "#6B7280", marginTop: 6, marginBottom: 20 },
  photoBox: {
    height: 220,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#D1D5DB",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  photo: { width: "100%", height: "100%" },
  photoBoxText: { color: "#9CA3AF", fontSize: 14 },
  notesInput: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    padding: 12,
    minHeight: 60,
    backgroundColor: "#fff",
    fontSize: 14,
    textAlignVertical: "top",
  },
  submitButton: { backgroundColor: "#111827", borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 20 },
  submitButtonDisabled: { opacity: 0.6 },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
