import { NextRequest, NextResponse } from "next/server";
import { createDriverConnectOnboardingLink } from "@/lib/payments";
import { requireDriver, authErrorResponse } from "@/lib/auth";

// POST /api/drivers/:driverId/stripe-onboarding-link
// body: { refreshUrl: string; returnUrl: string }
//
// Called by the driver app before a USD trip can ever reach ASSIGNED for
// that driver — releaseEscrow() in lib/escrow.ts refuses to pay out a USD
// trip until Driver.stripeOnboarded is true. AZN-only drivers never need
// to hit this endpoint (see lib/payments/localGatewayProvider.ts).
//
// The returned URL is a one-time-use, short-lived Stripe-hosted onboarding
// flow — open it in an in-app browser (expo-web-browser), not a WebView,
// since Stripe's onboarding pages block being framed.
export async function POST(req: NextRequest, { params }: { params: { driverId: string } }) {
  try {
    await requireDriver(req, params.driverId);

    const { refreshUrl, returnUrl } = (await req.json()) as { refreshUrl: string; returnUrl: string };
    if (!refreshUrl || !returnUrl) {
      return NextResponse.json({ message: "refreshUrl and returnUrl are required" }, { status: 400 });
    }

    const url = await createDriverConnectOnboardingLink(params.driverId, refreshUrl, returnUrl);
    return NextResponse.json({ url });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/drivers/:id/stripe-onboarding-link] failed:", err);
    return NextResponse.json({ message: "Failed to create onboarding link" }, { status: 500 });
  }
}
