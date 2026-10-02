import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyTransition, InvalidTransitionError } from "@/lib/tripStateMachine";
import { sendPushToLoadOwner } from "@/lib/push";
import { requireDriver, authErrorResponse } from "@/lib/auth";

// POST /api/trips/:tripId/pod
// Driver submits Proof of Delivery. Expects the photo already uploaded to
// object storage (S3/Supabase Storage) client-side; this endpoint just
// records the resulting URL and advances the trip to DELIVERED.
//
// (Uploading the raw photo bytes through this JSON route would be a poor
// fit for large images — the driver app uploads directly to storage and
// hands this endpoint the resulting public/signed URL. See
// driver-app/screens/ProofOfDeliveryScreen.tsx for that flow.)
//
// Phase 5: driverId now comes from the verified bearer token, not the
// request body — the body previously supplied its own driverId, which was
// checked against the trip but never verified as belonging to whoever was
// actually making the request.
export async function POST(req: NextRequest, { params }: { params: { tripId: string } }) {
  try {
    const driver = await requireDriver(req);

    const { photoUrl, notes } = (await req.json()) as { photoUrl: string; notes?: string };
    if (!photoUrl) {
      return NextResponse.json({ message: "photoUrl is required" }, { status: 400 });
    }

    const trip = await db.trip.findUniqueOrThrow({
      where: { id: params.tripId },
      include: { load: true },
    });
    if (trip.driverId !== driver.id) {
      return NextResponse.json({ message: "This trip is not assigned to you" }, { status: 403 });
    }

    await db.proofOfDelivery.upsert({
      where: { tripId: params.tripId },
      create: { tripId: params.tripId, driverId: driver.id, photoUrl, notes },
      update: { photoUrl, notes, uploadedAt: new Date() },
    });

    const updated = await applyTransition(params.tripId, "DELIVERED");

    sendPushToLoadOwner(
      trip.load.ownerId,
      "notifications.tripDeliveredTitle",
      "notifications.tripDeliveredBody",
      undefined,
      { type: "TRIP_DELIVERED", tripId: updated.id }
    ).catch((err) => console.warn("[pod] push failed", err));

    return NextResponse.json({ tripId: updated.id, status: updated.status });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    if (err instanceof InvalidTransitionError) {
      return NextResponse.json({ message: err.message }, { status: 409 });
    }
    console.error("[/api/trips/:id/pod] failed:", err);
    return NextResponse.json({ message: "Failed to submit proof of delivery" }, { status: 500 });
  }
}
