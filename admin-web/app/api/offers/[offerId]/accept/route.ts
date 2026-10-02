import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyTransition } from "@/lib/tripStateMachine";
import { expireStaleOffers } from "@/lib/matching";
import { createEscrowHold } from "@/lib/escrow";
import { requireDriver, authErrorResponse } from "@/lib/auth";

// POST /api/offers/:offerId/accept
// First driver to hit this wins the trip. Everyone else's PENDING offer
// for the same trip is flipped to EXPIRED in the same transaction, so
// there is never a window where two drivers both believe they got the load.
//
// Phase 5: this route previously had NO identity check at all — offerId
// alone was enough, meaning any request (or, once auth existed elsewhere,
// any OTHER driver's valid token) could accept an offer that was broadcast
// to a completely different driver. requireDriver() below resolves the
// bearer token to a Driver row; the explicit `driver.id !== offer.driverId`
// check then confirms it's the SAME driver this specific offer was sent to.
export async function POST(req: NextRequest, { params }: { params: { offerId: string } }) {
  try {
    const driver = await requireDriver(req);

    const offer = await db.loadOffer.findUnique({
      where: { id: params.offerId },
      include: { trip: true },
    });
    if (!offer) return NextResponse.json({ message: "Offer not found" }, { status: 404 });
    if (offer.driverId !== driver.id) {
      return NextResponse.json({ message: "This offer was not sent to you" }, { status: 403 });
    }

    await expireStaleOffers(offer.tripId);

    const result = await db.$transaction(async (tx) => {
      // Re-fetch inside the transaction to guard against a concurrent accept.
      const fresh = await tx.loadOffer.findUniqueOrThrow({ where: { id: offer.id } });

      if (fresh.status !== "PENDING") {
        return { ok: false as const, reason: "This load is no longer available." };
      }

      const trip = await tx.trip.findUniqueOrThrow({ where: { id: fresh.tripId } });
      if (trip.status !== "SEARCHING") {
        return { ok: false as const, reason: "This load has already been assigned to another driver." };
      }

      await tx.loadOffer.update({
        where: { id: fresh.id },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });

      await tx.loadOffer.updateMany({
        where: { tripId: fresh.tripId, status: "PENDING", NOT: { id: fresh.id } },
        data: { status: "EXPIRED", respondedAt: new Date() },
      });

      await tx.trip.update({
        where: { id: fresh.tripId },
        data: { driverId: fresh.driverId },
      });

      return { ok: true as const, tripId: fresh.tripId };
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.reason }, { status: 409 });
    }

    // Place the real payment hold BEFORE committing the trip to ASSIGNED.
    // If the load owner's card is declined or their payment setup is
    // incomplete, we want that to surface as a failed accept — not as a
    // driver who's been assigned to a load that can never actually pay out.
    // (The driver's offer is already ACCEPTED/other offers EXPIRED at this
    // point; a hold failure here should be surfaced to ops as a load that
    // needs re-broadcasting, which is a Phase 4 concern — noted, not solved, here.)
    try {
      await createEscrowHold(result.tripId);
    } catch (err) {
      console.error("[/api/offers/:id/accept] payment hold failed:", err);
      return NextResponse.json(
        { message: "Could not place a payment hold for this load. The load owner's payment method needs attention." },
        { status: 402 }
      );
    }

    await applyTransition(result.tripId, "ASSIGNED");

    return NextResponse.json({ tripId: result.tripId, status: "ASSIGNED" });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/offers/:id/accept] failed:", err);
    return NextResponse.json({ message: "Failed to accept offer" }, { status: 500 });
  }
}
