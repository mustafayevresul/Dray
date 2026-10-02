import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { api } from "../services/api";
import { DriverRegistrationInput } from "../types";
import { useTranslation } from "../i18n/LocaleProvider";
import { TranslationKey } from "../../i18n/translate";
import LanguageSelector from "./LanguageSelector";

type FieldKey = keyof DriverRegistrationInput;

const FIELD_CONFIG: {
  key: FieldKey;
  labelKey: TranslationKey;
  placeholder: string;
  keyboardType?: "default" | "numeric" | "phone-pad";
}[] = [
  { key: "fullName", labelKey: "driverRegistration.fullName", placeholder: "Jane Doe" },
  { key: "truckBrand", labelKey: "driverRegistration.truckBrand", placeholder: "Volvo, MAN, Scania..." },
  { key: "truckModel", labelKey: "driverRegistration.truckModel", placeholder: "FH16" },
  { key: "truckLengthM", labelKey: "driverRegistration.truckLength", placeholder: "13.6", keyboardType: "numeric" },
  { key: "maxCapacityTons", labelKey: "driverRegistration.maxCapacity", placeholder: "24", keyboardType: "numeric" },
  { key: "licenseNumber", labelKey: "driverRegistration.licenseNumber", placeholder: "DL-XXXXXXXX" },
  { key: "plateNumber", labelKey: "driverRegistration.plateNumber", placeholder: "ABC-1234" },
];

const REQUIRED_FIELDS: FieldKey[] = FIELD_CONFIG.map((f) => f.key);

type FormState = Record<FieldKey, string>;

const initialState: FormState = {
  fullName: "",
  truckBrand: "",
  truckModel: "",
  truckLengthM: "",
  maxCapacityTons: "",
  licenseNumber: "",
  plateNumber: "",
};

// This is the very first screen a new driver sees, before we have a
// driverId to sync a locale preference against the server — so the
// language selector here is purely local (AsyncStorage-backed via
// LocaleProvider) until registration completes and services/api.ts's
// updateDriverLocale can start persisting it server-side too.
export default function RegistrationScreen({ onRegistered }: { onRegistered: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});

  function updateField(key: FieldKey, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): boolean {
    const nextErrors: Partial<Record<FieldKey, string>> = {};
    for (const key of REQUIRED_FIELDS) {
      if (!form[key].trim()) nextErrors[key] = t("driverRegistration.required");
    }
    if (form.truckLengthM && isNaN(Number(form.truckLengthM))) {
      nextErrors.truckLengthM = t("driverRegistration.mustBeNumber");
    }
    if (form.maxCapacityTons && isNaN(Number(form.maxCapacityTons))) {
      nextErrors.maxCapacityTons = t("driverRegistration.mustBeNumber");
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const payload: DriverRegistrationInput = {
        ...form,
        truckLengthM: Number(form.truckLengthM),
        maxCapacityTons: Number(form.maxCapacityTons),
      };
      await api.registerDriver(payload);
      onRegistered();
    } catch (err) {
      Alert.alert(
        "Registration failed",
        err instanceof Error ? err.message : "Please check your details and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.languageRow}>
        <LanguageSelector />
      </View>

      <Text style={styles.title}>{t("driverRegistration.title")}</Text>
      <Text style={styles.subtitle}>{t("driverRegistration.subtitle")}</Text>

      {FIELD_CONFIG.map((field) => (
        <View key={field.key} style={styles.fieldGroup}>
          <Text style={styles.label}>{t(field.labelKey)}</Text>
          <TextInput
            style={[styles.input, errors[field.key] && styles.inputError]}
            placeholder={field.placeholder}
            placeholderTextColor="#9CA3AF"
            value={form[field.key]}
            onChangeText={(v) => updateField(field.key, v)}
            keyboardType={field.keyboardType ?? "default"}
          />
          {errors[field.key] && <Text style={styles.errorText}>{errors[field.key]}</Text>}
        </View>
      ))}

      <TouchableOpacity
        style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>{t("driverRegistration.submitButton")}</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 20, paddingBottom: 48 },
  languageRow: { alignItems: "flex-end", marginBottom: 8 },
  title: { fontSize: 24, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 14, color: "#6B7280", marginTop: 4, marginBottom: 24 },
  fieldGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    backgroundColor: "#fff",
    color: "#111827",
  },
  inputError: { borderColor: "#EF4444" },
  errorText: { color: "#EF4444", fontSize: 12, marginTop: 4 },
  submitButton: {
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 12,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
