import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import * as Location from "expo-location";
import { startDriverTracking, stopDriverTracking } from "../services/locationService";
import { api } from "../services/api";
import { PendingOffer, ActiveTrip } from "../types";
import ActiveTripScreen from "./ActiveTripScreen";
import LanguageSelector from "./LanguageSelector";
import { useTranslation } from "../i18n/LocaleProvider";

const OFFERS_POLL_MS = 6 * 1000; // short poll: offers expire in 90s, so this needs to be snappy
const ACTIVE_TRIP_POLL_MS = 15 * 1000;

/**
 * Home Screen — deliberately has NO "Go Online / Go Offline" button.
 *
 * The moment this screen mounts, background tracking starts and stays
 * on for as long as the driver is logged in. Dispatch offers simply
 * appear as the matching engine broadcasts them — the same pattern as
 * Uber/Bolt's driver app. Once a trip is active, this screen hands off
 * to ActiveTripScreen for the rest of the lifecycle (loading -> transit
 * -> proof of delivery).
 */
export default function HomeScreen({ driverId }: { driverId: string }) {
  const { t } = useTranslation();
  const [region, setRegion] = useState<Region | null>(null);
  const [offers, setOffers] = useState<PendingOffer[]>([]);
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null | undefined>(undefined); // undefined = not checked yet
  const [trackingReady, setTrackingReady] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeTripPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 1. Start background GPS tracking as soon as the driver lands here.
  useEffect(() => {
    (async () => {
      const result = await startDriverTracking(driverId);
      if (!result.ok) {
        Alert.alert(
          "Location required",
          result.reason ??
            "This app needs background location access to find loads near you."
        );
        return;
      }
      setTrackingReady(true);

      const current = await Location.getCurrentPositionAsync({});
      setRegion({
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      });
    })();

    return () => {
      stopDriverTracking();
    };
  }, [driverId]);

  // 2. Continuously check whether this driver already has an active trip —
  //    e.g. they re-opened the app mid-delivery. If so, skip straight past
  //    the offer feed into the trip lifecycle screen.
  const checkActiveTrip = useCallback(async () => {
    try {
      const trip = await api.getActiveTrip(driverId);
      setActiveTrip(trip);
    } catch (err) {
      console.warn("[HomeScreen] failed to check active trip", err);
    }
  }, [driverId]);

  useEffect(() => {
    if (!trackingReady) return;
    checkActiveTrip();
    activeTripPollRef.current = setInterval(checkActiveTrip, ACTIVE_TRIP_POLL_MS);
    return () => {
      if (activeTripPollRef.current) clearInterval(activeTripPollRef.current);
    };
  }, [trackingReady, checkActiveTrip]);

  // 3. Poll for dispatch offers — but only while FREE (no active trip).
  //    This IS the "Bolt/Uber-style" auto-matching feed.
  const fetchOffers = useCallback(async () => {
    try {
      const pending = await api.getPendingOffers(driverId);
      setOffers(pending);
    } catch (err) {
      console.warn("[HomeScreen] failed to refresh offers", err);
    }
  }, [driverId]);

  useEffect(() => {
    if (!trackingReady || activeTrip) return;
    fetchOffers();
    pollRef.current = setInterval(fetchOffers, OFFERS_POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [trackingReady, activeTrip, fetchOffers]);

  async function handleAccept(offerId: string) {
    try {
      const { tripId } = await api.acceptOffer(offerId);
      setOffers([]);
      await checkActiveTrip(); // immediately flips this screen over to ActiveTripScreen
      Alert.alert("Load accepted", "Navigate to the pickup point to begin.");
    } catch (err) {
      Alert.alert(
        "Couldn't accept load",
        err instanceof Error ? err.message : "This load may have just been taken by another driver."
      );
      fetchOffers(); // refresh — the offer that failed is likely gone now
    }
  }

  // Once assigned, hand off entirely to the trip lifecycle screen.
  if (activeTrip) {
    return (
      <ActiveTripScreen
        trip={activeTrip}
        onTripFinished={() => setActiveTrip(null)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.mapWrapper}>
        {region ? (
          <MapView style={StyleSheet.absoluteFillObject} initialRegion={region} showsUserLocation>
            {offers.map((offer) => (
              <Marker
                key={offer.offerId}
                coordinate={{ latitude: offer.load.pickupLat, longitude: offer.load.pickupLng }}
                title={offer.load.pickupAddr}
                description={`${offer.load.cargoTons}t · ${(offer.load.offeredRateCents / 100).toFixed(0)} ${offer.load.currency}`}
              />
            ))}
          </MapView>
        ) : (
          <View style={styles.mapLoading}>
            <Text style={styles.mapLoadingText}>{t("driverHome.gettingLocation")}</Text>
          </View>
        )}
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveBadgeText}>{t("driverHome.liveBadge")}</Text>
        </View>
      </View>

      <View style={styles.feedContainer}>
        <View style={styles.feedHeaderRow}>
          <Text style={styles.feedTitle}>{t("driverHome.offersTitle", { count: offers.length })}</Text>
          <LanguageSelector driverId={driverId} />
        </View>
        <FlatList
          data={offers}
          keyExtractor={(item) => item.offerId}
          ListEmptyComponent={
            <Text style={styles.emptyText}>{t("driverHome.noOffers")}</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.loadCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.loadRoute} numberOfLines={1}>
                  {item.load.pickupAddr} → {item.load.dropoffAddr}
                </Text>
                <Text style={styles.loadMeta}>
                  {item.distanceKm.toFixed(1)} km away · {item.load.cargoTons}t · {item.load.cargoType}
                </Text>
              </View>
              <Text style={styles.loadPrice}>
                {(item.load.offeredRateCents / 100).toFixed(0)} {item.load.currency}
              </Text>
              <TouchableOpacity style={styles.acceptButton} onPress={() => handleAccept(item.offerId)}>
                <Text style={styles.acceptButtonText}>{t("driverHome.accept")}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  mapWrapper: { height: "50%", backgroundColor: "#E5E7EB" },
  mapLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  mapLoadingText: { color: "#6B7280" },
  liveBadge: {
    position: "absolute",
    top: 16,
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(17,24,39,0.85)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22C55E",
    marginRight: 6,
  },
  liveBadgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  feedContainer: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  feedHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  feedTitle: { fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 12 },
  emptyText: { color: "#9CA3AF", fontSize: 13, textAlign: "center", marginTop: 24 },
  loadCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  loadRoute: { fontSize: 14, fontWeight: "600", color: "#111827" },
  loadMeta: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  loadPrice: { fontSize: 15, fontWeight: "700", color: "#111827", marginHorizontal: 10 },
  acceptButton: { backgroundColor: "#111827", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  acceptButtonText: { color: "#fff", fontSize: 13, fontWeight: "600" },
});
