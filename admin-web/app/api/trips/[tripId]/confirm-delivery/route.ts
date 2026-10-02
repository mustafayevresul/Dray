import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyTransition, InvalidTransitionError } from "@/lib/tripStateMachine";
import { releaseEscrow } from "@/lib/escrow";
import { sendPushToDriver } from "@/lib/push";
import { requireLoadOwner, authErrorResponse } from "@/lib/auth";

// POST /api/trips/:tripId/confirm-delivery
// Load Owner reviews the Proof of Delivery photo and confirms. This is
// THE trigger for money moving: escrow is released, the platform's
// commission (6-8%, snapshotted on this trip) is captured permanently,
// and the driver's payout is finalized. Trip -> COMPLETED (terminal).
//
// Phase 5: ownerId now comes from the verified bearer token, not the
// request body. This is the single highest-stakes route in the app to get
// identity right on — it's what releases real money — so it gets the same
// requireLoadOwner() treatment as every other route rather than any
// special-casing.
export async function POST(req: NextRequest, { params }: { params: { tripId: string } }) {
  try {
    const owner = await requireLoadOwner(req);

    const trip = await db.trip.findUniqueOrThrow({
      where: { id: params.tripId },
      include: { load: true, proofOfDelivery: true },
    });

    if (trip.load.ownerId !== owner.id) {
      return NextResponse.json({ message: "This trip does not belong to you" }, { status: 403 });
    }
    if (!trip.proofOfDelivery) {
      return NextResponse.json({ message: "No proof of delivery has been submitted yet" }, { status: 409 });
    }

    // Order matters, and it's the reverse of Phase 2: capture the real
    // payment FIRST, only flip the trip to COMPLETED once money has
    // actually moved. If we transitioned first and the Stripe/local-gateway
    // capture then failed (e.g. driver never finished Connect onboarding),
    // we'd be left with a trip marked "done" and no payment behind it —
    // exactly the inconsistency a payments system can't tolerate.
    // releaseEscrow is idempotent, so a retry after a partial failure here
    // (capture succeeded, this request then crashed) is always safe.
    const escrow = await releaseEscrow(params.tripId);
    const updated = await applyTransition(params.tripId, "COMPLETED");

    if (trip.driverId) {
      sendPushToDriver(
        trip.driverId,
        "notifications.tripDeliveredTitle", // reused: "payment released" copy can be split out as its own key later
        "notifications.tripDeliveredBody",
        undefined,
        { type: "TRIP_COMPLETED", tripId: updated.id }
      ).catch((err) => console.warn("[confirm-delivery] driver push failed", err));
    }

    return NextResponse.json({
      tripId: updated.id,
      status: updated.status,
      commissionCapturedCents: escrow.commissionCapturedCents,
      driverPayoutCents: escrow.driverPayoutCents,
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    if (err instanceof InvalidTransitionError) {
      return NextResponse.json({ message: err.message }, { status: 409 });
    }
    console.error("[/api/trips/:id/confirm-delivery] failed:", err);
    return NextResponse.json({ message: "Failed to confirm delivery" }, { status: 500 });
  }
}
