import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { requireLoadOwner, authErrorResponse } from "@/lib/auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", { apiVersion: "2024-06-20" });

// POST /api/load-owners/:ownerId/setup-payment-method
// Only relevant for owners posting USD loads — AZN loads settle through
// the local gateway (see lib/payments/localGatewayProvider.ts), which has
// its own payment-method-on-file mechanism outside Stripe entirely.
//
// Returns a SetupIntent client secret. The load-owner-web app uses
// Stripe.js + Stripe Elements client-side to collect the card and confirm
// this SetupIntent; once confirmed, Stripe's `setup_intent.succeeded`
// webhook (see admin-web/app/api/webhooks/stripe) attaches the resulting
// payment method as the customer's default, which is what
// stripeProvider.ts's createHold() charges off-session later.
export async function POST(req: NextRequest, { params }: { params: { ownerId: string } }) {
  try {
    await requireLoadOwner(req, params.ownerId);

    const owner = await db.loadOwner.findUniqueOrThrow({
      where: { id: params.ownerId },
      include: { user: true },
    });

    let customerId = owner.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: owner.fullName,
        phone: owner.user.phone,
        email: owner.user.email ?? undefined,
        metadata: { ownerId: owner.id },
      });
      customerId = customer.id;
      await db.loadOwner.update({ where: { id: owner.id }, data: { stripeCustomerId: customerId } });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: "off_session", // this card will be charged later without the owner present, at delivery confirmation
    });

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/load-owners/:id/setup-payment-method] failed:", err);
    return NextResponse.json({ message: "Failed to start payment setup" }, { status: 500 });
  }
}
