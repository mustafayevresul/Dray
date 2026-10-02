import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser, authErrorResponse } from "@/lib/auth";

// POST /api/load-owners/register
// Never existed before Phase 5 — load-owner-web had no signup flow at all,
// only the hardcoded CURRENT_OWNER_ID placeholder. Same pattern as driver
// registration: requires a verified Supabase session; phone comes from the
// session, not the request body.
export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);

    const existingUser = await db.user.findUnique({ where: { authUserId: authUser.id } });
    if (existingUser) {
      return NextResponse.json({ message: "This account is already registered" }, { status: 409 });
    }
    if (!authUser.phone) {
      return NextResponse.json({ message: "No verified phone number on this session" }, { status: 400 });
    }

    const { fullName, companyName } = (await req.json()) as { fullName: string; companyName?: string };
    if (!fullName?.trim()) {
      return NextResponse.json({ message: "fullName is required" }, { status: 400 });
    }

    const owner = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { authUserId: authUser.id, phone: authUser.phone!, role: "LOAD_OWNER" },
      });
      return tx.loadOwner.create({
        data: { userId: user.id, fullName: fullName.trim(), companyName: companyName?.trim() },
      });
    });

    return NextResponse.json({ id: owner.id }, { status: 201 });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/load-owners/register] failed:", err);
    return NextResponse.json({ message: "Registration failed" }, { status: 500 });
  }
}
