/**
 * Matching Engine — Phase 2
 *
 * Runs once, synchronously, the moment a Load Owner publishes a load.
 * Mirrors the Bolt/Uber dispatch pattern: broadcast to every eligible
 * nearby driver at once (not one-at-a-time), first ACCEPT wins.
 *
 * "Eligible" driver = FREE (see driverAvailability.ts: fresh GPS ping,
 * no open trip) AND within SEARCH_RADIUS_KM of the pickup point AND
 * ACTIVE (passed verification) AND truck can physically carry the load.
 */

import { db } from "@/lib/db";
import { isLocationFresh } from "@/lib/driverAvailability";
import { sendPushToManyDrivers } from "@/lib/push";

const SEARCH_RADIUS_KM = 100; // widen/narrow per corridor density; make this configurable later
const OFFER_TTL_MS = 90 * 1000; // an unanswered offer expires after 90s, freeing the driver up for the next broadcast

// Haversine distance — fine at N=hundreds of active drivers. Swap for a
// PostGIS ST_DWithin query (see README) once the active-driver count
// makes an in-app full scan too slow.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function broadcastLoadToNearbyDrivers(tripId: string) {
  const trip = await db.trip.findUniqueOrThrow({
    where: { id: tripId },
    include: { load: true },
  });

  // Only ACTIVE drivers are candidates at all; freshness (FREE) is
  // checked in-memory below since it depends on "now", not a stored column.
  const candidates = await db.driver.findMany({
    where: {
      status: "ACTIVE",
      lastLat: { not: null },
      lastLng: { not: null },
      maxCapacityTons: { gte: trip.load.cargoTons },
      ...(trip.load.requiredLengthM ? { truckLengthM: { gte: trip.load.requiredLengthM } } : {}),
      // Exclude drivers already mid-trip: no open Trip in an active status.
      trips: { none: { status: { in: ["ASSIGNED", "LOADING", "IN_TRANSIT", "DELIVERED"] } } },
    },
  });

  const nearbyFree = candidates
    .filter((d) => isLocationFresh(d.locationUpdatedAt))
    .map((d) => ({
      driver: d,
      distanceKm: haversineKm(trip.load.pickupLat, trip.load.pickupLng, d.lastLat!, d.lastLng!),
    }))
    .filter((d) => d.distanceKm <= SEARCH_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  if (nearbyFree.length === 0) {
    return { offersSent: 0 };
  }

  const expiresAt = new Date(Date.now() + OFFER_TTL_MS);
  await db.loadOffer.createMany({
    data: nearbyFree.map(({ driver, distanceKm }) => ({
      tripId: trip.id,
      driverId: driver.id,
      distanceKm,
      expiresAt,
    })),
  });

  await sendPushToManyDrivers(
    nearbyFree.map(({ driver, distanceKm }) => ({
      driverId: driver.id,
      vars: {
        distance: distanceKm.toFixed(1),
        price: `${(trip.load.offeredRateCents / 100).toFixed(0)} ${trip.load.currency}`,
      },
    })),
    "notifications.newOfferTitle",
    "notifications.newOfferBody",
    { type: "NEW_OFFER", tripId: trip.id }
  );

  return { offersSent: nearbyFree.length };
}

/**
 * Lazily expires stale PENDING offers. Called at the top of both the
 * "get my offers" and "accept offer" routes rather than run as a cron,
 * so Phase 2 needs no background worker yet.
 */
export async function expireStaleOffers(tripId: string) {
  await db.loadOffer.updateMany({
    where: { tripId, status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED", respondedAt: new Date() },
  });
}
