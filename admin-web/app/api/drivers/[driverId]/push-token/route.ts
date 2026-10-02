import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDriver, authErrorResponse } from "@/lib/auth";

// POST /api/drivers/:driverId/push-token   body: { expoPushToken: string }
// Called once by the driver app after requesting notification permissions
// (see driver-app/services/pushRegistration.ts). Idempotent — re-registering
// the same token on every app launch is fine and expected.
export async function POST(req: NextRequest, { params }: { params: { driverId: string } }) {
  try {
    await requireDriver(req, params.driverId);

    const { expoPushToken } = (await req.json()) as { expoPushToken: string };
    if (!expoPushToken) {
      return NextResponse.json({ message: "expoPushToken is required" }, { status: 400 });
    }
    await db.driver.update({ where: { id: params.driverId }, data: { expoPushToken } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/drivers/:id/push-token] failed:", err);
    return NextResponse.json({ message: "Failed to register push token" }, { status: 500 });
  }
}
