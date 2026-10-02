import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { refundEscrow } from "@/lib/escrow";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", { apiVersion: "2024-06-20" });
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

// POST /api/webhooks/stripe
// Stripe Connect onboarding and card setup both finish asynchronously on
// Stripe's hosted pages, outside our request/response cycle — this webhook
// is how those outcomes make it back into our DB. Register this URL in the
// Stripe Dashboard (or via the CLI: `stripe listen --forward-to
// localhost:3000/api/webhooks/stripe`) subscribed to at least:
//   account.updated, setup_intent.succeeded, payment_intent.payment_failed
export async function POST(req: NextRequest) {
  const body = await req.text(); // raw body required for signature verification — do NOT req.json() first
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    if (!signature || !webhookSecret) throw new Error("Missing signature or webhook secret");
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("[webhooks/stripe] signature verification failed:", err);
    return NextResponse.json({ message: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "account.updated": {
        // Fired throughout a driver's Connect Express onboarding. We only
        // care about the moment they become able to *receive* transfers.
        const account = event.data.object as Stripe.Account;
        if (account.charges_enabled || account.payouts_enabled) {
          await db.driver.updateMany({
            where: { stripeAccountId: account.id },
            data: { stripeOnboarded: true },
          });
        }
        break;
      }

      case "setup_intent.succeeded": {
        // Load owner finished entering a card. Attach it as the default
        // payment method so stripeProvider.ts's off-session charge at
        // hold-time has something to charge.
        const setupIntent = event.data.object as Stripe.SetupIntent;
        if (setupIntent.customer && setupIntent.payment_method) {
          const customerId =
            typeof setupIntent.customer === "string" ? setupIntent.customer : setupIntent.customer.id;
          const paymentMethodId =
            typeof setupIntent.payment_method === "string"
              ? setupIntent.payment_method
              : setupIntent.payment_method.id;

          await stripe.customers.update(customerId, {
            invoice_settings: { default_payment_method: paymentMethodId },
          });
        }
        break;
      }

      case "payment_intent.payment_failed": {
        // The hold placed at ASSIGNED time couldn't be authorized (expired
        // card, insufficient funds, etc). Refund/void our side of the
        // ledger so it doesn't sit stuck at HELD against money that was
        // never actually secured. The trip itself is left for ops/Phase 4
        // to re-broadcast or cancel — this webhook only reconciles the
        // payment record, it doesn't make trip-lifecycle decisions.
        const intent = event.data.object as Stripe.PaymentIntent;
        const tripId = intent.metadata?.tripId;
        if (tripId) {
          await refundEscrow(tripId).catch((err) =>
            console.error(`[webhooks/stripe] failed to reconcile failed payment for trip ${tripId}:`, err)
          );
        }
        break;
      }

      default:
        // Unhandled event types are expected and fine to ignore — Stripe
        // sends far more event types than any one integration needs.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error(`[webhooks/stripe] handler failed for ${event.type}:`, err);
    // Return 200 anyway once we've logged: returning an error here makes
    // Stripe retry, and most of these failures (e.g. a trip already
    // deleted) won't resolve themselves on retry.
    return NextResponse.json({ received: true, note: "logged internally" });
  }
}
