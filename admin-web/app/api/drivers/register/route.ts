import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser, authErrorResponse } from "@/lib/auth";

type DriverRegistrationInput = {
  fullName: string;
  licenseNumber: string;
  plateNumber: string;
  truckBrand: string;
  truckModel: string;
  truckLengthM: number;
  maxCapacityTons: number;
};

// POST /api/drivers/register
// Phase 5: requires a verified Supabase session — the driver-app now
// completes phone OTP verification (PhoneEntryScreen -> OtpVerifyScreen)
// BEFORE this screen is ever reached, so a valid bearer token always exists
// by the time RegistrationScreen submits. The phone number itself now comes
// from the verified auth session (`authUser.phone`), NOT from the request
// body — taking phone from the body would let someone register a Driver
// profile under a phone number they never actually proved they control.
export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);

    // If this auth account already has a User row, this is a re-submission
    // or a mistaken second registration attempt, not a new account.
    const existingUser = await db.user.findUnique({ where: { authUserId: authUser.id } });
    if (existingUser) {
      return NextResponse.json({ message: "This account is already registered" }, { status: 409 });
    }
    if (!authUser.phone) {
      // Should not happen for a phone-OTP session, but Supabase's type
      // allows it (e.g. email-based sessions) — fail closed rather than
      // creating a User row with an empty phone.
      return NextResponse.json({ message: "No verified phone number on this session" }, { status: 400 });
    }

    const body: DriverRegistrationInput = await req.json();
    const required: (keyof DriverRegistrationInput)[] = [
      "fullName", "licenseNumber", "plateNumber",
      "truckBrand", "truckModel", "truckLengthM", "maxCapacityTons",
    ];
    const missing = required.filter((f) => body[f] === undefined || body[f] === null || body[f] === "");
    if (missing.length > 0) {
      return NextResponse.json({ message: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }

    const [existingLicense, existingPlate] = await Promise.all([
      db.driver.findUnique({ where: { licenseNumber: body.licenseNumber } }),
      db.driver.findUnique({ where: { plateNumber: body.plateNumber } }),
    ]);
    if (existingLicense) {
      return NextResponse.json({ message: "This driver's license number is already registered" }, { status: 409 });
    }
    if (existingPlate) {
      return NextResponse.json({ message: "This vehicle plate is already registered" }, { status: 409 });
    }

    const driver = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { authUserId: authUser.id, phone: authUser.phone!, role: "DRIVER" },
      });

      return tx.driver.create({
        data: {
          userId: user.id,
          fullName: body.fullName,
          licenseNumber: body.licenseNumber,
          plateNumber: body.plateNumber,
          truckBrand: body.truckBrand,
          truckModel: body.truckModel,
          truckLengthM: body.truckLengthM,
          maxCapacityTons: body.maxCapacityTons,
          // status defaults to PENDING_VERIFICATION, locale defaults to AZ
        },
      });
    });

    return NextResponse.json({ id: driver.id }, { status: 201 });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/drivers/register] failed:", err);
    return NextResponse.json({ message: "Registration failed" }, { status: 500 });
  }
}
