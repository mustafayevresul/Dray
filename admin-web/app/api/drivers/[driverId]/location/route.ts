import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDriver, authErrorResponse } from "@/lib/auth";

// POST /api/drivers/:driverId/location   body: { latitude, longitude, heading?, speedKph? }
//
// This is the single most important endpoint in the app: it's what
// driver-app/services/locationService.ts's background task calls every
// ~60s (or 150m of movement), and it's the ONLY thing that makes a driver
// show up as FREE anywhere — lib/driverAvailability.ts's isLocationFresh()
// and lib/matching.ts's broadcast query both key off `locationUpdatedAt`,
// which only this route ever writes.
//
// Phase 5: requireDriver() confirms the bearer token belongs to exactly
// this :driverId — otherwise anyone with a driverId (visible in plenty of
// API responses) could spoof another driver's GPS position.
//
// Writes to two places: `Driver.lastLat/lastLng/locationUpdatedAt` (the hot
// path every availability/matching check reads) and a `DriverLocationPing`
// history row (for the trip-tracking map's "last seen" trail and any
// future analytics). Both in one transaction so they never drift apart.
export async function POST(req: NextRequest, { params }: { params: { driverId: string } }) {
  try {
    await requireDriver(req, params.driverId);

    const { latitude, longitude, heading, speedKph } = (await req.json()) as {
      latitude: number;
      longitude: number;
      heading?: number;
      speedKph?: number;
    };

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return NextResponse.json({ message: "latitude and longitude are required numbers" }, { status: 400 });
    }

    const now = new Date();

    await db.$transaction([
      db.driver.update({
        where: { id: params.driverId },
        data: { lastLat: latitude, lastLng: longitude, locationUpdatedAt: now },
      }),
      db.driverLocationPing.create({
        data: { driverId: params.driverId, lat: latitude, lng: longitude, heading, speedKph, recordedAt: now },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/drivers/:id/location] failed:", err);
    // Deliberately still a 500, not swallowed: locationService.ts already
    // treats a failed ping as non-fatal (logs and waits for the next cycle),
    // so there's no need to hide the failure from that caller too.
    return NextResponse.json({ message: "Failed to record location" }, { status: 500 });
  }
}
