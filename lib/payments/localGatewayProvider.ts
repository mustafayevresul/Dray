import Stripe from "stripe";
import { Trip, EscrowTransaction } from "@prisma/client";
import { PaymentProvider } from "./types";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-06-20",
});

/**
 * Stripe Connect (Express accounts), manual-capture flow — used for
 * USD-priced trips. Maps onto the HELD/RELEASED/REFUNDED escrow states:
 *
 *   HELD      -> PaymentIntent created with capture_method: "manual" and
 *                confirmed (funds authorized on the load owner's card).
 *                The destination account AND the commission split are set
 *                HERE, at creation — not at capture. This is a real Stripe
 *                API constraint, not a style choice: `transfer_data` only
 *                accepts a `destination` field on PaymentIntentCreateParams.
 *                The capture endpoint's `transfer_data` only accepts an
 *                optional `amount` (to partially adjust an already-set
 *                transfer) — it has no `destination` field at all. Passing
 *                `transfer_data: { destination }` into `capture()` is what
 *                produced the original TypeScript error, and it would have
 *                failed at the Stripe API level even without strict types
 *                catching it first.
 *   RELEASED  -> PaymentIntent captured. Since destination + application
 *                fee were already attached at creation, a bare `capture()`
 *                call is enough — Stripe applies the pre-configured split
 *                automatically.
 *   REFUNDED  -> PaymentIntent cancelled (if not yet captured) — releases
 *                the authorization hold without moving any money.
 *
 * Requires: the Load Owner has a Stripe Customer with a saved payment
 * method (`LoadOwner.stripeCustomerId`), and the Driver has completed
 * Connect Express onboarding (`Driver.stripeAccountId`,
 * `Driver.stripeOnboarded`) — checked below at hold-creation time, which
 * is also earlier than before: a driver who can't be paid now fails the
 * hold immediately at accept-time, rather than only being discovered when
 * delivery is confirmed and capture is attempted.
 */
export const stripeProvider: PaymentProvider = {
  type: "STRIPE_CONNECT",

  async createHold(trip: Trip) {
    if (trip.currency !== "USD") {
      throw new Error(`stripeProvider cannot hold a ${trip.currency} trip — Stripe doesn't settle AZN.`);
    }

    const ownerCustomerId = await getOwnerStripeCustomerId(trip.loadId);
    const driverAccountId = await getDriverStripeAccountId(trip);

    const intent = await stripe.paymentIntents.create({
      amount: trip.freightPriceCents,
      currency: "usd",
      customer: ownerCustomerId,
      capture_method: "manual", // authorize now, capture on delivery confirmation
      confirm: true,
      off_session: true, // load owner isn't present at hold time — charging a saved card
      application_fee_amount: trip.commissionCents, // platform's cut, withheld automatically on capture
      transfer_data: { destination: driverAccountId }, // MUST be set here; capture-time has no destination field
      metadata: { tripId: trip.id },
    });

    return { providerIntentId: intent.id };
  },

  async captureAndPayout(trip, escrow, driverStripeAccountId) {
    if (!escrow.providerIntentId) {
      throw new Error(`Escrow for trip ${trip.id} has no Stripe PaymentIntent to capture`);
    }

    // driverStripeAccountId is part of the shared PaymentProvider interface
    // (lib/payments/types.ts) so every provider's captureAndPayout has the
    // same signature, but Stripe's version doesn't need it here — the
    // destination was already locked in at createHold() above. Kept as a
    // no-op reference rather than silently dropping the parameter, so a
    // future reader doesn't wonder whether it was forgotten.
    void driverStripeAccountId;

    const captured = await stripe.paymentIntents.capture(escrow.providerIntentId);

    const chargeId =
      typeof captured.latest_charge === "string" ? captured.latest_charge : captured.latest_charge?.id;

    return { providerTransferId: chargeId ?? captured.id };
  },

  async voidHold(escrow) {
    if (!escrow.providerIntentId) {
      throw new Error(`Escrow ${escrow.id} has no Stripe PaymentIntent to void`);
    }
    const cancelled = await stripe.paymentIntents.cancel(escrow.providerIntentId);
    return { providerRefundId: cancelled.id };
  },
};

async function getOwnerStripeCustomerId(loadId: string): Promise<string> {
  const { db } = await import("@/lib/db");
  const load = await db.load.findUniqueOrThrow({ where: { id: loadId }, include: { owner: true } });
  if (!load.owner.stripeCustomerId) {
    throw new Error(
      `Load owner ${load.owner.id} has no Stripe customer on file — complete payment setup before posting a load.`
    );
  }
  return load.owner.stripeCustomerId;
}

/**
 * Resolves the driver's Connect account at HOLD time (not capture time —
 * see the module comment above for why). Fails fast if the driver hasn't
 * finished onboarding, which the Phase 3 audit's ordering fix in
 * offers/accept/route.ts relies on: the hold is placed BEFORE the trip is
 * committed to ASSIGNED, so this throwing here correctly blocks the whole
 * assignment rather than assigning a driver who can never be paid.
 */
async function getDriverStripeAccountId(trip: Trip): Promise<string> {
  if (!trip.driverId) {
    throw new Error(`Trip ${trip.id} has no assigned driver yet — cannot create a destination-charge hold.`);
  }
  const { db } = await import("@/lib/db");
  const driver = await db.driver.findUniqueOrThrow({ where: { id: trip.driverId } });
  if (!driver.stripeAccountId || !driver.stripeOnboarded) {
    throw new Error(
      `Driver ${driver.id} has not completed Stripe Connect onboarding — cannot place a USD payment hold.`
    );
  }
  return driver.stripeAccountId;
}

/**
 * Creates a Stripe Connect Express account + onboarding link for a driver.
 * Called by admin-web/app/api/drivers/[driverId]/stripe-onboarding-link.
 */
export async function createDriverConnectOnboardingLink(driverId: string, refreshUrl: string, returnUrl: string) {
  const { db } = await import("@/lib/db");
  const driver = await db.driver.findUniqueOrThrow({ where: { id: driverId } });

  let accountId = driver.stripeAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      capabilities: { transfers: { requested: true } },
      metadata: { driverId },
    });
    accountId = account.id;
    await db.driver.update({ where: { id: driverId }, data: { stripeAccountId: accountId } });
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return link.url;
}
export const localGatewayProvider = {
  // faylın mövcud məzmunu...
};
