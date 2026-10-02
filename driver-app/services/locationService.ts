import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { api } from "./api";

/**
 * CORE PRODUCT LOGIC:
 * There is no manual "Busy / Empty" toggle in this app. A driver is
 * considered part of the live matching pool purely because their phone
 * is reporting GPS. This file is the entire mechanism behind that:
 *
 *   1. Foreground: normal watchPositionAsync while the app is open.
 *   2. Background: an OS-level background task (via expo-task-manager)
 *      keeps reporting location even if the driver backgrounds the app,
 *      which is what makes the "always part of the ecosystem" feel work.
 *
 * Requires (app.json):
 *   - "location" background mode (iOS: UIBackgroundModes: ["location"])
 *   - ACCESS_BACKGROUND_LOCATION permission (Android)
 *   - Clear in-app disclosure before requesting background permission
 *     (required by both Apple and Google review policies).
 */

export const LOCATION_TASK_NAME = "freight-driver-background-location";
const PING_INTERVAL_MS = 60 * 1000; // 60s cadence: battery-friendly, still feels "live"
const PING_DISTANCE_M = 150; // or when the driver has moved this far, whichever comes first

let currentDriverId: string | null = null;

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error("[locationService] background task error:", error);
    return;
  }
  const { locations } = (data as { locations: Location.LocationObject[] }) ?? {};
  const latest = locations?.[locations.length - 1];
  if (!latest || !currentDriverId) return;

  try {
    await api.pingLocation(
      currentDriverId,
      { latitude: latest.coords.latitude, longitude: latest.coords.longitude },
      latest.coords.heading ?? undefined,
      latest.coords.speed ? latest.coords.speed * 3.6 : undefined // m/s -> km/h
    );
  } catch (err) {
    // Swallow network errors here; the next ping (60s later) will retry.
    // We deliberately do not surface this to the driver — there is no
    // status UI to update, by design.
    console.warn("[locationService] ping failed, will retry next cycle", err);
  }
});

export async function startDriverTracking(driverId: string): Promise<{ ok: boolean; reason?: string }> {
  currentDriverId = driverId;

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") {
    return { ok: false, reason: "Foreground location permission denied." };
  }

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== "granted") {
    // App still works foreground-only, but the driver will "go dark"
    // in the matching pool the moment they background the app.
    return { ok: false, reason: "Background location permission denied." };
  }

  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (alreadyRunning) return { ok: true };

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: PING_INTERVAL_MS,
    distanceInterval: PING_DISTANCE_M,
    showsBackgroundLocationIndicator: true, // iOS: honest blue-bar disclosure to the driver
    foregroundService: {
      // Android: persistent notification, required for background location
      notificationTitle: "You're online",
      notificationBody: "Sharing your location so nearby loads can find you.",
    },
  });

  return { ok: true };
}

export async function stopDriverTracking() {
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  currentDriverId = null;
}
