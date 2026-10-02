import { NextRequest, NextResponse } from "next/server";
import { Locale } from "@prisma/client";
import { db } from "@/lib/db";
import { requireLoadOwner, authErrorResponse } from "@/lib/auth";

// POST /api/load-owners/:ownerId/locale   body: { locale: "AZ" | "TR" | "RU" | "KA" | "EN" }
export async function POST(req: NextRequest, { params }: { params: { ownerId: string } }) {
  try {
    await requireLoadOwner(req, params.ownerId);

    const { locale } = (await req.json()) as { locale: Locale };
    if (!Object.values(Locale).includes(locale)) {
      return NextResponse.json({ message: "Invalid locale" }, { status: 400 });
    }
    await db.loadOwner.update({ where: { id: params.ownerId }, data: { locale } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/load-owners/:id/locale] failed:", err);
    return NextResponse.json({ message: "Failed to update locale" }, { status: 500 });
  }
}
