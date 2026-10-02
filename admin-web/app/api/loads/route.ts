import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { broadcastLoadToNearbyDrivers } from "@/lib/matching";
import { requireLoadOwner, authErrorResponse } from "@/lib/auth";

type CreateLoadBody = {
  pickupLat: number;
  pickupLng: number;
  pickupAddr: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddr: string;
  cargoType: string;
  cargoTons: number;
  requiredLengthM?: number;
  offeredRateCents: number;
  currency: "USD" | "AZN";
};

// POST /api/loads
// Load Owner posts a new shipment. Creates the Load + its Trip
// (status SEARCHING) in one transaction, then immediately broadcasts
// to nearby FREE drivers. Commission is snapshotted from the live
// PlatformConfig at creation time, per the Phase 1 revenue model.
//
// Phase 5: ownerId now comes from the verified bearer token, not the
// request body — previously anyone could post a load "as" any load owner
// simply by supplying that owner's id in the JSON body.
export async function POST(req: NextRequest) {
  try {
    const owner = await requireLoadOwner(req);
    const body: CreateLoadBody = await req.json();

    const requiredFields: (keyof CreateLoadBody)[] = [
      "pickupLat", "pickupLng", "pickupAddr",
      "dropoffLat", "dropoffLng", "dropoffAddr",
      "cargoType", "cargoTons", "offeredRateCents", "currency",
    ];
    const missing = requiredFields.filter((f) => body[f] === undefined || body[f] === null);
    if (missing.length > 0) {
      return NextResponse.json({ message: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }

    const config = await db.platformConfig.findUnique({ where: { id: "singleton" } });
    const commissionPct = config?.commissionPct ?? 0.07;
    const commissionCents = Math.round(body.offeredRateCents * commissionPct);
    const driverPayoutCents = body.offeredRateCents - commissionCents;

    const trip = await db.$transaction(async (tx) => {
      const load = await tx.load.create({
        data: {
          ownerId: owner.id,
          pickupLat: body.pickupLat,
          pickupLng: body.pickupLng,
          pickupAddr: body.pickupAddr,
          dropoffLat: body.dropoffLat,
          dropoffLng: body.dropoffLng,
          dropoffAddr: body.dropoffAddr,
          cargoType: body.cargoType,
          cargoTons: body.cargoTons,
          requiredLengthM: body.requiredLengthM,
          offeredRateCents: body.offeredRateCents,
          currency: body.currency,
          status: "OPEN",
        },
      });

      return tx.trip.create({
        data: {
          loadId: load.id,
          status: "SEARCHING",
          currency: body.currency,
          freightPriceCents: body.offeredRateCents,
          commissionPct,
          commissionCents,
          driverPayoutCents,
        },
      });
    });

    const { offersSent } = await broadcastLoadToNearbyDrivers(trip.id);

    return NextResponse.json(
      { tripId: trip.id, loadId: trip.loadId, offersSent },
      { status: 201 }
    );
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/loads POST] failed:", err);
    return NextResponse.json({ message: "Failed to create load" }, { status: 500 });
  }
}

// GET /api/loads — list the authenticated owner's own loads. The ?ownerId=
// query param is gone: Phase 5 derives it from the token, so there's no way
// to pass a different owner's id and list their loads instead.
export async function GET(req: NextRequest) {
  try {
    const owner = await requireLoadOwner(req);

    const loads = await db.load.findMany({
      where: { ownerId: owner.id },
      orderBy: { createdAt: "desc" },
      include: { trip: { include: { driver: true } } },
    });

    return NextResponse.json(loads);
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/loads GET] failed:", err);
    return NextResponse.json({ message: "Failed to load shipments" }, { status: 500 });
  }
}
