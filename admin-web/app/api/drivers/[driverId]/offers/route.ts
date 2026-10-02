import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { expireStaleOffers } from "@/lib/matching";
import { requireDriver, authErrorResponse } from "@/lib/auth";

// GET /api/drivers/:driverId/offers
// Polled by the driver app every ~5-8s while FREE. Returns this driver's
// currently PENDING dispatch offers, newest/nearest first. This is the
// Phase 2 replacement for Phase 1's simpler "browse nearby loads" feed —
// offers are pushed to specific drivers by the matching engine rather
// than the client filtering a public list itself.
export async function GET(req: NextRequest, { params }: { params: { driverId: string } }) {
  try {
    await requireDriver(req, params.driverId);

    const pending = await db.loadOffer.findMany({
      where: { driverId: params.driverId, status: "PENDING" },
      include: { trip: { include: { load: true } } },
      orderBy: { distanceKm: "asc" },
    });

    // Lazily expire anything that timed out since the last poll, per trip.
    await Promise.all([...new Set(pending.map((o) => o.tripId))].map(expireStaleOffers));

    // Re-filter after expiry in case any of the above just went stale.
    const stillPending = pending.filter((o) => o.expiresAt.getTime() > Date.now());

    return NextResponse.json(
      stillPending.map((o) => ({
        offerId: o.id,
        tripId: o.tripId,
        distanceKm: o.distanceKm,
        expiresAt: o.expiresAt,
        load: {
          pickupAddr: o.trip.load.pickupAddr,
          dropoffAddr: o.trip.load.dropoffAddr,
          cargoType: o.trip.load.cargoType,
          cargoTons: o.trip.load.cargoTons,
          offeredRateCents: o.trip.load.offeredRateCents,
          currency: o.trip.load.currency,
          pickupLat: o.trip.load.pickupLat,
          pickupLng: o.trip.load.pickupLng,
        },
      }))
    );
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/drivers/:id/offers] failed:", err);
    return NextResponse.json({ message: "Failed to load offers" }, { status: 500 });
  }
}
