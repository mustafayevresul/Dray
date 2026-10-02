import Stripe from "stripe";
import { Trip, EscrowTransaction } from "@prisma/client";
import { PaymentProvider } from "./types";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-06-20",
});

/**
 * Stripe Connect (Express accounts), manual-capture flow — used for
 * USD-priced trips. Maps directly onto the HELD/RELEASED/REFUNDED escrow
 * states:
 *
 *   HELD      -> PaymentIntent created with capture_method: "manual"
 *                and confirmed (funds authorized on the load owner's card)
 *   RELEASED  -> PaymentIntent captured; platform keeps the commission via
 *                `application_fee_amount`, the rest auto-transfers to the
 *                driver's connected account via `transfer_data.destination`
 *   REFUNDED  -> PaymentIntent cancelled (if not yet captured) — releases
 *                the authorization hold without moving any money
 *
 * Requires: the Load Owner has a Stripe Customer with a saved payment
 * method (`LoadOwner.stripeCustomerId`), and the Driver has completed
 * Connect Express onboarding (`Driver.stripeAccountId`,
 * `Driver.stripeOnboarded`). Both are set up via the onboarding endpoints
 * in admin-web/app/api/drivers/[driverId]/stripe-onboarding-link and
 * admin-web/app/api/load-owners/[ownerId]/setup-payment-method (Phase 3).
 */
export const stripeProvider: PaymentProvider = {
  type: "STRIPE_CONNECT",

  async createHold(trip: Trip) {
    if (trip.currency !== "USD") {
      throw new Error(`stripeProvider cannot hold a ${trip.currency} trip — Stripe doesn't settle AZN.`);
    }

    const ownerCustomerId = await getOwnerStripeCustomerId(trip.loadId);

    const intent = await stripe.paymentIntents.create({
      amount: trip.freightPriceCents,
      currency: "usd",
      customer: ownerCustomerId,
      capture_method: "manual", // authorize now, capture on delivery confirmation
      confirm: true,
      off_session: true, // load owner isn't present at hold time — charging a saved card
      metadata: { tripId: trip.id },
    });

    return { providerIntentId: intent.id };
  },

  async captureAndPayout(trip, escrow, driverStripeAccountId) {
    if (!escrow.providerIntentId) {
      throw new Error(`Escrow for trip ${trip.id} has no Stripe PaymentIntent to capture`);
    }

    // application_fee_amount = the platform's commission, withheld automatically;
    // the remainder settles to the driver's connected account in one capture call —
    // no separate Transfer object needed for a single-destination split.
    const captured = await stripe.paymentIntents.capture(escrow.providerIntentId, {
      application_fee_amount: trip.commissionCents,
      transfer_data: { destination: driverStripeAccountId },
    });

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
