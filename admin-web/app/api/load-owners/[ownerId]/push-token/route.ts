import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireLoadOwner, authErrorResponse } from "@/lib/auth";

// POST /api/load-owners/:ownerId/push-token   body: { webPushToken: string }
export async function POST(req: NextRequest, { params }: { params: { ownerId: string } }) {
  try {
    await requireLoadOwner(req, params.ownerId);

    const { webPushToken } = (await req.json()) as { webPushToken: string };
    if (!webPushToken) {
      return NextResponse.json({ message: "webPushToken is required" }, { status: 400 });
    }
    await db.loadOwner.update({ where: { id: params.ownerId }, data: { webPushToken } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/load-owners/:id/push-token] failed:", err);
    return NextResponse.json({ message: "Failed to register push token" }, { status: 500 });
  }
}
