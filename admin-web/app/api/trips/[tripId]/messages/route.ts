import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDriverOrLoadOwner, authErrorResponse, AuthError } from "@/lib/auth";

const ACTIVE_CHAT_STATUSES = ["ASSIGNED", "LOADING", "IN_TRANSIT", "DELIVERED"] as const;

async function assertParticipant(tripId: string, identity: Awaited<ReturnType<typeof requireDriverOrLoadOwner>>) {
  const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId }, include: { load: true } });
  const isParticipant =
    (identity.role === "DRIVER" && trip.driverId === identity.driver.id) ||
    (identity.role === "LOAD_OWNER" && trip.load.ownerId === identity.loadOwner.id);
  if (!isParticipant) throw new AuthError("You are not a participant on this trip", 403);
  return trip;
}

// GET /api/trips/:tripId/messages — full history, oldest first.
// Real-time delivery of NEW messages does NOT poll this endpoint: the
// driver app and load-owner web both subscribe directly to Supabase
// Realtime's Postgres change-stream on the ChatMessage table (see
// driver-app/services/chat.ts and load-owner-web/lib/chat.ts). This route
// is only for the initial history load when a chat screen first opens.
//
// Phase 5: previously fully public — anyone with a tripId could read any
// trip's chat history. Now requires the caller to be one of the trip's two
// actual participants.
export async function GET(req: NextRequest, { params }: { params: { tripId: string } }) {
  try {
    const identity = await requireDriverOrLoadOwner(req);
    await assertParticipant(params.tripId, identity);

    const messages = await db.chatMessage.findMany({
      where: { tripId: params.tripId },
      orderBy: { sentAt: "asc" },
    });
    return NextResponse.json(messages);
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/trips/:id/messages GET] failed:", err);
    return NextResponse.json({ message: "Failed to load messages" }, { status: 500 });
  }
}

// POST /api/trips/:tripId/messages   body: { body: string }
// Chat is scoped to the lifecycle window — only ASSIGNED..DELIVERED trips
// can exchange messages, mirroring the real-world need (once COMPLETED,
// there's nothing left to coordinate; before ASSIGNED, there's no
// counterpart to talk to yet).
//
// Phase 5: senderRole/driverId/ownerId used to come straight from the
// request body — anyone could post a message claiming to be either side
// of the conversation. Both are now derived entirely from the verified
// bearer token; the body only ever supplies the message text.
export async function POST(req: NextRequest, { params }: { params: { tripId: string } }) {
  try {
    const identity = await requireDriverOrLoadOwner(req);
    const trip = await assertParticipant(params.tripId, identity);

    const { body } = (await req.json()) as { body: string };
    if (!body?.trim()) {
      return NextResponse.json({ message: "Message body is required" }, { status: 400 });
    }
    if (!ACTIVE_CHAT_STATUSES.includes(trip.status as (typeof ACTIVE_CHAT_STATUSES)[number])) {
      return NextResponse.json(
        { message: `Chat is only available while a trip is active (current status: ${trip.status})` },
        { status: 409 }
      );
    }

    const message = await db.chatMessage.create({
      data: {
        tripId: params.tripId,
        senderRole: identity.role,
        driverId: identity.role === "DRIVER" ? identity.driver.id : undefined,
        ownerId: identity.role === "LOAD_OWNER" ? identity.loadOwner.id : undefined,
        body: body.trim(),
      },
    });

    // No explicit push notification call here: Supabase Realtime already
    // delivers the message instantly while the recipient's chat screen is
    // open. A "new message" push for when the app is backgrounded is a
    // reasonable future addition (same sendPushToDriver/sendPushToLoadOwner
    // helpers from lib/push.ts would cover it) — left out here to keep chat
    // notifications from doubling up with the realtime subscription.

    return NextResponse.json(message, { status: 201 });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/trips/:id/messages POST] failed:", err);
    return NextResponse.json({ message: "Failed to send message" }, { status: 500 });
  }
}
