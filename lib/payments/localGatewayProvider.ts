import { Trip, EscrowTransaction } from "@prisma/client";
import { PaymentProvider } from "./types";

/**
 * Local gateway provider — used for AZN-priced trips, since Stripe does
 * not settle Azerbaijani manat. Implements the exact same HELD/RELEASED/
 * REFUNDED contract as stripeProvider.ts so `lib/escrow.ts` never has to
 * branch on currency itself.
 *
 * This is a clearly-marked INTEGRATION STUB. Swap the method bodies for
 * calls to your chosen local processor's SDK/REST API — in Azerbaijan,
 * Payriff, EPoint, and Kapital Bank's merchant API are common choices,
 * all of which support a hold-then-capture (or a two-step
 * authorize/capture) flow that maps onto these same three methods.
 * The manual-payout comment on captureAndPayout is deliberate: local
 * gateways in this market generally don't offer Stripe Connect-style
 * automatic marketplace splits, so driver payout is typically a
 * separate bank transfer initiated by ops rather than API-automated —
 * track that transfer's reference in `providerTransferId` regardless
 * of whether it was automatic or manual.
 */
export const localGatewayProvider: PaymentProvider = {
  type: "LOCAL_GATEWAY",

  async createHold(trip: Trip) {
    if (trip.currency !== "AZN") {
      throw new Error(`localGatewayProvider only handles AZN trips, got ${trip.currency}`);
    }

    // TODO: replace with a real call, e.g.:
    //   const auth = await payriff.authorize({ amount: trip.freightPriceCents, currency: "AZN", ... });
    //   return { providerIntentId: auth.transactionId };
    console.warn(
      `[localGatewayProvider] STUB: would authorize ${trip.freightPriceCents / 100} AZN for trip ${trip.id}`
    );
    return { providerIntentId: `local-hold-${trip.id}` };
  },

  async captureAndPayout(trip, escrow) {
    if (!escrow.providerIntentId) {
      throw new Error(`Escrow for trip ${trip.id} has no local gateway hold to capture`);
    }

    // TODO: replace with a real capture call, then queue/execute the
    // driver's bank payout via whatever mechanism ops uses for AZN payouts.
    console.warn(
      `[localGatewayProvider] STUB: would capture ${escrow.heldAmountCents / 100} AZN ` +
        `(commission ${trip.commissionCents / 100}, driver payout ${trip.driverPayoutCents / 100}) for trip ${trip.id}`
    );
    return { providerTransferId: `local-capture-${trip.id}` };
  },

  async voidHold(escrow) {
    // TODO: replace with a real void/refund call.
    console.warn(`[localGatewayProvider] STUB: would void hold ${escrow.providerIntentId}`);
    return { providerRefundId: `local-refund-${escrow.id}` };
  },
};
