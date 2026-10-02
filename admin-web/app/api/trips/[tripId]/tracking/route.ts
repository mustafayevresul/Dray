import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireLoadOwner, authErrorResponse } from "@/lib/auth";

// GET /api/trips/:tripId/tracking
// Polled by the Load Owner's live map (every few seconds while a trip is
// ASSIGNED/LOADING/IN_TRANSIT) to plot the driver's current position.
//
// Phase 5: this route was completely open — no auth of any kind. Given it
// returns a driver's live GPS position and phone number, that's about as
// bad as an authorization gap gets. Now restricted to the load owner who
// actually owns this trip's load.
export async function GET(req: NextRequest, { params }: { params: { tripId: string } }) {
  try {
    const owner = await requireLoadOwner(req);

    const trip = await db.trip.findUnique({
      where: { id: params.tripId },
      include: {
        load: true,
        driver: {
          select: {
            fullName: true,
            truckBrand: true,
            truckModel: true,
            plateNumber: true,
            lastLat: true,
            lastLng: true,
            locationUpdatedAt: true,
            user: { select: { phone: true } },
          },
        },
      },
    });

    if (!trip) return NextResponse.json({ message: "Trip not found" }, { status: 404 });
    if (trip.load.ownerId !== owner.id) {
      return NextResponse.json({ message: "This trip does not belong to you" }, { status: 403 });
    }

    return NextResponse.json({
      tripStatus: trip.status,
      pickup: { lat: trip.load.pickupLat, lng: trip.load.pickupLng, addr: trip.load.pickupAddr },
      dropoff: { lat: trip.load.dropoffLat, lng: trip.load.dropoffLng, addr: trip.load.dropoffAddr },
      driver: trip.driver
        ? {
            name: trip.driver.fullName,
            vehicle: `${trip.driver.truckBrand} ${trip.driver.truckModel} · ${trip.driver.plateNumber}`,
            phone: trip.driver.user.phone,
            lat: trip.driver.lastLat,
            lng: trip.driver.lastLng,
            locationUpdatedAt: trip.driver.locationUpdatedAt,
          }
        : null,
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/trips/:id/tracking] failed:", err);
    return NextResponse.json({ message: "Failed to load tracking data" }, { status: 500 });
  }
}
