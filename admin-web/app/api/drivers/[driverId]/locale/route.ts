export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { Locale } from "@prisma/client";
import { db } from "@/lib/db";
import { requireDriver, authErrorResponse } from "@/lib/auth";

// POST /api/drivers/:driverId/locale   body: { locale: "AZ" | "TR" | "RU" | "KA" | "EN" }
// Best-effort sync so server-rendered copy (push notification titles/bodies
// in lib/push.ts) matches the language the driver picked in-app.
export async function POST(req: NextRequest, { params }: { params: { driverId: string } }) {
  try {
    await requireDriver(req, params.driverId);

    const { locale } = (await req.json()) as { locale: Locale };
    if (!Object.values(Locale).includes(locale)) {
      return NextResponse.json({ message: "Invalid locale" }, { status: 400 });
    }
    await db.driver.update({ where: { id: params.driverId }, data: { locale } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/drivers/:id/locale] failed:", err);
    return NextResponse.json({ message: "Failed to update locale" }, { status: 500 });
  }
}
