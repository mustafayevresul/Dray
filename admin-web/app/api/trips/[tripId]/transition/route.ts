import { NextRequest, NextResponse } from "next/server";
import { TripStatus } from "@prisma/client";
import { applyTransition, InvalidTransitionError } from "@/lib/tripStateMachine";
import { db } from "@/lib/db";
import { sendPushToLoadOwner } from "@/lib/push";
import { requireDriver, authErrorResponse } from "@/lib/auth";

// POST /api/trips/:tripId/transition   body: { to: "LOADING" | "IN_TRANSIT" | "CANCELLED" }
//
// Covers the driver-driven middle of the lifecycle:
//   ASSIGNED  -> LOADING     (driver arrived at pickup, starting to load cargo)
//   LOADING   -> IN_TRANSIT  (cargo loaded, departing for drop-off)
// DELIVERED and COMPLETED have their own dedicated routes (pod, confirm-delivery)
// because they carry extra side effects (photo upload, escrow release).
//
// Phase 5: previously took no driverId at all and did no identity check —
// any request could flip any trip's status. Now requires a driver token and
// confirms that driver is the one actually assigned to this trip.
const ALLOWED_HERE: TripStatus[] = ["LOADING", "IN_TRANSIT", "CANCELLED"];

export async function POST(req: NextRequest, { params }: { params: { tripId: string } }) {
  try {
    const driver = await requireDriver(req);

    const trip = await db.trip.findUnique({ where: { id: params.tripId } });
    if (!trip) return NextResponse.json({ message: "Trip not found" }, { status: 404 });
    if (trip.driverId !== driver.id) {
      return NextResponse.json({ message: "This trip is not assigned to you" }, { status: 403 });
    }

    const { to } = (await req.json()) as { to: TripStatus };

    if (!ALLOWED_HERE.includes(to)) {
      return NextResponse.json(
        { message: `Use a dedicated endpoint to transition to ${to}` },
        { status: 400 }
      );
    }

    const updated = await applyTransition(params.tripId, to);

    if (to === "IN_TRANSIT") {
      const load = await db.load.findUnique({ where: { id: updated.loadId } });
      if (load) {
        // Fire-and-forget: a failed push should never fail the trip update.
        sendPushToLoadOwner(
          load.ownerId,
          "notifications.tripInTransitTitle",
          "notifications.tripInTransitBody",
          undefined,
          { type: "TRIP_IN_TRANSIT", tripId: updated.id }
        ).catch((err) => console.warn("[transition] push failed", err));
      }
    }

    return NextResponse.json({ tripId: updated.id, status: updated.status });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    if (err instanceof InvalidTransitionError) {
      return NextResponse.json({ message: err.message }, { status: 409 });
    }
    console.error("[/api/trips/:id/transition] failed:", err);
    return NextResponse.json({ message: "Failed to update trip" }, { status: 500 });
  }
}
