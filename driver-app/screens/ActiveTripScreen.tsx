import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../services/api";
import { ActiveTrip } from "../types";
import ProofOfDeliveryScreen from "./ProofOfDeliveryScreen";
import ChatScreen from "./ChatScreen";
import { useTranslation } from "../i18n/LocaleProvider";

const STATUS_KEYS: Record<
  ActiveTrip["status"],
  { titleKey: string; helperKey: string }
> = {
  ASSIGNED: { titleKey: "activeTrip.headingToPickup", helperKey: "activeTrip.headingToPickupHelper" },
  LOADING: { titleKey: "activeTrip.loadingCargo", helperKey: "activeTrip.loadingCargoHelper" },
  IN_TRANSIT: { titleKey: "activeTrip.enRoute", helperKey: "activeTrip.enRouteHelper" },
  DELIVERED: { titleKey: "activeTrip.delivered", helperKey: "activeTrip.deliveredHelper" },
  COMPLETED: { titleKey: "activeTrip.completed", helperKey: "activeTrip.completedHelper" },
};

// This screen is what replaces a manual "Busy" toggle: the driver's state
// is entirely a function of `trip.status`, driven by these lifecycle
// buttons — not a free-floating availability switch.
export default function ActiveTripScreen({
  trip,
  onTripFinished,
}: {
  trip: ActiveTrip;
  onTripFinished: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(trip.status);
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  async function advance(to: "LOADING" | "IN_TRANSIT") {
    setBusy(true);
    try {
      const res = await api.transitionTrip(trip.id, to);
      setStatus(res.status as ActiveTrip["status"]);
    } catch (err) {
      Alert.alert("Couldn't update trip", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Chat is reachable from every stage of an active trip — coordinating
  // pickup/drop-off details is exactly when a driver and load owner need
  // to talk, so this sits above the per-status branching below rather
  // than being tucked into just one screen.
  if (chatOpen) {
    return (
      <View style={{ flex: 1 }}>
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={() => setChatOpen(false)} style={styles.chatBackButton}>
            <Ionicons name="chevron-back" size={20} color="#111827" />
            <Text style={styles.chatBackText}>{t("common.back")}</Text>
          </TouchableOpacity>
        </View>
        <ChatScreen tripId={trip.id} ownerPhone={trip.ownerPhone} />
      </View>
    );
  }

  if (status === "IN_TRANSIT") {
    // Driver has arrived at drop-off and needs to submit proof of delivery.
    // (In a fuller build, this branch would be reached via a "I've arrived"
    // button; kept as a direct hand-off here to keep Phase 2 focused.)
    return (
      <ProofOfDeliveryScreen
        tripId={trip.id}
        onSubmitted={() => setStatus("DELIVERED")}
      />
    );
  }

  const copy = STATUS_KEYS[status];

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.title}>{t(copy.titleKey as any)}</Text>
          <TouchableOpacity style={styles.chatIconButton} onPress={() => setChatOpen(true)}>
            <Ionicons name="chatbubble-ellipses" size={20} color="#111827" />
          </TouchableOpacity>
        </View>
        <Text style={styles.route}>
          {trip.pickupAddr} → {trip.dropoffAddr}
        </Text>
        <Text style={styles.helper}>{t(copy.helperKey as any)}</Text>
        <Text style={styles.payout}>
          {t("activeTrip.yourPayout", { amount: `${(trip.driverPayoutCents / 100).toFixed(0)} ${trip.currency}` })}
        </Text>

        {status === "ASSIGNED" && (
          <TouchableOpacity style={styles.button} onPress={() => advance("LOADING")} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("activeTrip.arrivedStartLoading")}</Text>}
          </TouchableOpacity>
        )}

        {status === "LOADING" && (
          <TouchableOpacity style={styles.button} onPress={() => advance("IN_TRANSIT")} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("activeTrip.loadedDepart")}</Text>}
          </TouchableOpacity>
        )}

        {status === "DELIVERED" && (
          <TouchableOpacity style={styles.buttonDisabled} disabled onPress={onTripFinished}>
            <Text style={styles.buttonText}>{t("activeTrip.waitingForOwner")}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB", justifyContent: "center", padding: 20 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 24, shadowOpacity: 0.05, shadowRadius: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chatIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  chatHeader: { paddingTop: 50, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: "#fff" },
  chatBackButton: { flexDirection: "row", alignItems: "center" },
  chatBackText: { fontSize: 15, color: "#111827", marginLeft: 2 },
  title: { fontSize: 20, fontWeight: "700", color: "#111827" },
  route: { fontSize: 14, color: "#374151", marginTop: 8 },
  helper: { fontSize: 13, color: "#6B7280", marginTop: 12 },
  payout: { fontSize: 15, fontWeight: "600", color: "#111827", marginTop: 16 },
  button: { backgroundColor: "#111827", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  buttonDisabled: { backgroundColor: "#9CA3AF", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});

