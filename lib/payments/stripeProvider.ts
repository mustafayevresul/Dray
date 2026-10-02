import Stripe from "stripe";
import { Trip } from "@prisma/client";
import { PaymentProvider } from "./types";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-06-20",
});

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
      capture_method: "manual",
      confirm: true,
      off_session: true,
      application_fee_amount: trip.commissionCents,
      transfer_data: { destination: driverAccountId },
      metadata: { tripId: trip.id },
    });

    return { providerIntentId: intent.id };
  },

  async captureAndPayout(trip, escrow, driverStripeAccountId) {
    if (!escrow.providerIntentId) {
      throw new Error(`Escrow for trip ${trip.id} has no Stripe PaymentIntent to capture`);
    }

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
