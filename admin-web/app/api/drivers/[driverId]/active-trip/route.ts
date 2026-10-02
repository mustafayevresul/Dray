import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDriver, authErrorResponse } from "@/lib/auth";

const ACTIVE_STATUSES = ["ASSIGNED", "LOADING", "IN_TRANSIT", "DELIVERED"] as const;

// GET /api/drivers/:driverId/active-trip
// The driver app calls this on launch/resume to decide what to show:
// null -> Home Screen (map + pending offers); non-null -> the active
// trip lifecycle screen (arrived/loading/depart/deliver actions).
export async function GET(req: NextRequest, { params }: { params: { driverId: string } }) {
  try {
    await requireDriver(req, params.driverId);

    const trip = await db.trip.findFirst({
      where: { driverId: params.driverId, status: { in: [...ACTIVE_STATUSES] } },
      include: { load: { include: { owner: { include: { user: true } } } } },
    });

    if (!trip) return NextResponse.json(null);

    return NextResponse.json({
      id: trip.id,
      status: trip.status,
      pickupAddr: trip.load.pickupAddr,
      dropoffAddr: trip.load.dropoffAddr,
      driverPayoutCents: trip.driverPayoutCents,
      currency: trip.currency,
      ownerPhone: trip.load.owner.user.phone,
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/drivers/:id/active-trip] failed:", err);
    return NextResponse.json({ message: "Failed to load active trip" }, { status: 500 });
  }
}
