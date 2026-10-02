import { Trip, EscrowTransaction } from "@prisma/client";

/**
 * One interface, two implementations — this is what lets `lib/escrow.ts`
 * stay completely unaware of which rail actually moved the money.
 * Selection happens once, in `resolveProvider()` (index.ts), based on the
 * trip's currency: AZN can't settle on Stripe, so it always routes local.
 */
export interface PaymentProvider {
  readonly type: "STRIPE_CONNECT" | "LOCAL_GATEWAY";

  /**
   * Called the instant a Trip becomes ASSIGNED. Authorizes (but does not
   * capture) the full freight price against the load owner's payment
   * method. Returns the provider's reference for that hold so it can be
   * captured or voided later.
   */
  createHold(trip: Trip): Promise<{ providerIntentId: string }>;

  /**
   * Called when the load owner confirms delivery. Captures the held funds
   * and splits them: commission stays with the platform, the remainder
   * transfers to the driver's payout destination.
   */
  captureAndPayout(
    trip: Trip,
    escrow: EscrowTransaction,
    driverPayoutDestination: string
  ): Promise<{ providerTransferId: string }>;

  /** Called when a trip is cancelled after a hold was already placed. */
  voidHold(escrow: EscrowTransaction): Promise<{ providerRefundId: string }>;
}
