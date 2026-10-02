import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser, authErrorResponse } from "@/lib/auth";

// GET /api/auth/me
// Called immediately after OTP verification, by both clients, to answer
// "does this phone number already have a Driver/LoadOwner profile, and if
// so which role and id?" — this is what lets App.tsx (driver) and the
// AuthProvider (load-owner-web) route straight to Home for a returning
// user, or to the registration form for a brand-new phone number, without
// ever trusting anything the client itself claims about who it is.
export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    const user = await db.user.findUnique({
      where: { authUserId: authUser.id },
      include: { driver: true, loadOwner: true },
    });

    if (!user) {
      return NextResponse.json({ registered: false, phone: authUser.phone ?? null });
    }
    if (user.driver) {
      return NextResponse.json({
        registered: true,
        role: "DRIVER",
        driverId: user.driver.id,
        driverStatus: user.driver.status,
      });
    }
    if (user.loadOwner) {
      return NextResponse.json({ registered: true, role: "LOAD_OWNER", ownerId: user.loadOwner.id });
    }
    // A User row with neither profile shouldn't normally happen (every
    // registration route creates both in one transaction), but fail safe
    // rather than crash if it ever does.
    return NextResponse.json({ registered: false, phone: authUser.phone ?? null });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/auth/me] failed:", err);
    return NextResponse.json({ message: "Failed to resolve session" }, { status: 500 });
  }
}
