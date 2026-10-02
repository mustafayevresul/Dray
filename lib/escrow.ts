/**
 * Escrow lifecycle — Phase 3: now wired to real payment rails.
 *
 *   Trip -> ASSIGNED     : EscrowTransaction created (HELD) AND a real
 *                          hold/authorization is placed via the resolved
 *                          PaymentProvider (Stripe Connect for USD,
 *                          local gateway for AZN — see lib/payments/).
 *   Trip -> DELIVERED    : no escrow change yet — waiting on load owner.
 *   Trip -> COMPLETED    : escrow RELEASED — the hold is captured and
 *                          split (commission retained, driver paid) via
 *                          the same provider that placed the hold.
 *   Trip -> CANCELLED    : escrow REFUNDED — the hold is voided.
 *
 * lib/escrow.ts is intentionally the ONLY module that talks to
 * lib/payments/* — nothing else in the app should import a provider
 * directly, so switching or adding a payment rail never touches API routes.
 */

import { db } from "@/lib/db";
import { resolvePaymentProvider } from "@/lib/payments";

export async function createEscrowHold(tripId: string) {
  const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId } });
  const provider = resolvePaymentProvider(trip.currency);

  const { providerIntentId } = await provider.createHold(trip);

  return db.escrowTransaction.create({
    data: {
      tripId,
      status: "HELD",
      heldAmountCents: trip.freightPriceCents,
      provider: provider.type,
      providerIntentId,
    },
  });
}

/**
 * The core "money" moment of the whole platform: load owner confirms
 * delivery -> the real hold is captured and split, commission is
 * captured *permanently*, and the driver's payout is finalized.
 *
 * Order matters and is deliberate: the provider capture call happens
 * BEFORE the DB is updated, and the DB write only happens if the
 * capture succeeded — so a failed Stripe/gateway call never leaves the
 * ledger showing money that didn't actually move. If the capture
 * succeeds but the subsequent DB write fails, this function is safe to
 * retry: `captureAndPayout` against an already-captured PaymentIntent
 * is a no-op on Stripe's side (it errors cleanly rather than double-charging).
 */
export async function releaseEscrow(tripId: string) {
  const trip = await db.trip.findUniqueOrThrow({
    where: { id: tripId },
    include: { escrow: true, driver: true },
  });

  if (!trip.escrow) throw new Error(`Trip ${tripId} has no escrow to release`);
  if (trip.escrow.status === "RELEASED") return trip.escrow; // idempotent: safe to call twice
  if (!trip.driverId || !trip.driver) throw new Error(`Trip ${tripId} has no assigned driver`);

  const payoutDestination = resolveDriverPayoutDestination(trip.driver, trip.currency);
  const provider = resolvePaymentProvider(trip.currency);

  const { providerTransferId } = await provider.captureAndPayout(trip, trip.escrow, payoutDestination);

  return db.$transaction(async (tx) => {
    const released = await tx.escrowTransaction.update({
      where: { tripId },
      data: {
        status: "RELEASED",
        commissionCapturedCents: trip.commissionCents,
        driverPayoutCents: trip.driverPayoutCents,
        providerTransferId,
        releasedAt: new Date(),
      },
    });

    await tx.driver.update({
      where: { id: trip.driverId! },
      data: {
        totalTrips: { increment: 1 },
        totalEarningsCents: { increment: trip.driverPayoutCents },
      },
    });

    return released;
  });
}

export async function refundEscrow(tripId: string) {
  const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId }, include: { escrow: true } });
  if (!trip.escrow || trip.escrow.status !== "HELD") return trip.escrow;

  const provider = resolvePaymentProvider(trip.currency);
  const { providerRefundId } = await provider.voidHold(trip.escrow);

  return db.escrowTransaction.update({
    where: { tripId },
    data: { status: "REFUNDED", providerRefundId, releasedAt: new Date() },
  });
}

/**
 * USD trips pay out to the driver's Stripe Connect account; AZN trips
 * pay out via the local gateway, which (per localGatewayProvider.ts) may
 * not need a "destination" string at all — kept as a placeholder string
 * so the PaymentProvider interface stays uniform across both rails.
 */
function resolveDriverPayoutDestination(
  driver: { stripeAccountId: string | null; stripeOnboarded: boolean; id: string },
  currency: "USD" | "AZN"
): string {
  if (currency === "USD") {
    if (!driver.stripeAccountId || !driver.stripeOnboarded) {
      throw new Error(
        `Driver ${driver.id} has not completed Stripe Connect onboarding — cannot release a USD payout.`
      );
    }
    return driver.stripeAccountId;
  }
  return driver.id; // local gateway resolves payout details from Driver.payoutBankDetails itself
}
