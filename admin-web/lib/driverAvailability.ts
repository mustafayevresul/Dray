/**
 * There is no manual "Busy / Empty" toggle anywhere in this system.
 * A driver's real-time state is always DERIVED from data, never set by hand:
 *
 *   ONLINE      -> locationUpdatedAt is within GPS_FRESHNESS_WINDOW_MS
 *   FREE        -> ONLINE and has no open trip (ACCEPTED / IN_PROGRESS)
 *   ON_TRIP     -> ONLINE and currently has an ACCEPTED / IN_PROGRESS trip
 *   OFFLINE     -> last GPS ping is stale (app closed / background killed)
 *
 * This keeps a single source of truth (GPS pings + trip state) instead of
 * trusting a driver-controlled flag, which is the whole point of the
 * "always-on ecosystem" behavior described in the product spec.
 */

export const GPS_FRESHNESS_WINDOW_MS = 90 * 1000; // 90s: matches mobile ping interval (see locationService.ts)

export type DriverRuntimeState = "FREE" | "ON_TRIP" | "OFFLINE";

export function isLocationFresh(locationUpdatedAt: Date | null): boolean {
  if (!locationUpdatedAt) return false;
  return Date.now() - locationUpdatedAt.getTime() < GPS_FRESHNESS_WINDOW_MS;
}

export function deriveDriverState(params: {
  locationUpdatedAt: Date | null;
  hasOpenTrip: boolean;
}): DriverRuntimeState {
  if (!isLocationFresh(params.locationUpdatedAt)) return "OFFLINE";
  return params.hasOpenTrip ? "ON_TRIP" : "FREE";
}
