import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "../../i18n/translate";
import { useTranslation } from "../i18n/LocaleProvider";

export default function LanguageSelector({ driverId }: { driverId?: string }) {
  const { locale, setLocale, t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("auth.chooseLanguage")}</Text>
      <View style={styles.grid}>
        {SUPPORTED_LOCALES.map((code) => (
          <TouchableOpacity
            key={code}
            style={[styles.chip, code === locale && styles.chipActive]}
            onPress={() => setLocale(code, driverId)}
          >
            <Text style={[styles.chipText, code === locale && styles.chipTextActive]}>
              {LOCALE_LABELS[code]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  title: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: "#111827", borderColor: "#111827" },
  chipText: { fontSize: 13, color: "#374151", fontWeight: "500" },
  chipTextActive: { color: "#fff" },
});
