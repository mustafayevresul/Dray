/**
 * Trip Lifecycle State Machine
 *
 *   SEARCHING -> ASSIGNED -> LOADING -> IN_TRANSIT -> DELIVERED -> COMPLETED
 *                    \           \           \            \
 *                     `---------------- CANCELLED ---------'
 *
 * Every route that changes `Trip.status` MUST go through `assertValidTransition`
 * (or the higher-level `applyTransition` helper below) rather than writing the
 * status directly. This is what keeps e.g. a driver from skipping straight to
 * DELIVERED without ever going IN_TRANSIT, or a load owner confirming a trip
 * that hasn't been delivered yet.
 */

import { TripStatus } from "@prisma/client";
import { db } from "@/lib/db";

const ALLOWED_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  SEARCHING: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["LOADING", "CANCELLED"],
  LOADING: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["DELIVERED", "CANCELLED"],
  DELIVERED: ["COMPLETED", "CANCELLED"], // e.g. load owner disputes -> CANCELLED, handled in Phase 3
  COMPLETED: [],
  CANCELLED: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: TripStatus, to: TripStatus) {
    super(`Cannot transition trip from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertValidTransition(from: TripStatus, to: TripStatus) {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

// Maps a Trip's granular status onto the simpler Load-level status shown
// in owner-facing list views.
export function loadStatusForTripStatus(status: TripStatus) {
  switch (status) {
    case "SEARCHING":
      return "OPEN" as const;
    case "ASSIGNED":
    case "LOADING":
    case "IN_TRANSIT":
    case "DELIVERED":
      return "IN_PROGRESS" as const;
    case "COMPLETED":
      return "COMPLETED" as const;
    case "CANCELLED":
      return "CANCELLED" as const;
  }
}

const TIMESTAMP_FIELD: Partial<Record<TripStatus, string>> = {
  ASSIGNED: "assignedAt",
  LOADING: "loadingStartedAt",
  IN_TRANSIT: "transitStartedAt",
  DELIVERED: "deliveredAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
};

/**
 * Applies a validated transition inside a single DB transaction:
 * updates Trip.status, stamps the relevant timestamp, and keeps the
 * parent Load's simplified status in sync. Extra per-transition side
 * effects (broadcasting offers, releasing escrow) are handled by the
 * calling route AFTER this succeeds, so a failed side effect never
 * leaves the trip in a half-updated state.
 */
export async function applyTransition(tripId: string, to: TripStatus) {
  return db.$transaction(async (tx) => {
    const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
    assertValidTransition(trip.status, to);

    const timestampField = TIMESTAMP_FIELD[to];
    const updated = await tx.trip.update({
      where: { id: tripId },
      data: {
        status: to,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
      },
    });

    await tx.load.update({
      where: { id: trip.loadId },
      data: { status: loadStatusForTripStatus(to) },
    });

    return updated;
  });
}
