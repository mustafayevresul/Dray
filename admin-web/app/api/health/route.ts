import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/health
// Point your uptime monitor (Better Uptime, UptimeRobot, Vercel's own
// Checks, etc.) here after go-live. Verifies the actual DB connection,
// not just that the Next.js process is up — a running server with a dead
// DB connection is not "healthy" for this app.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "connected", checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/health] DB check failed:", err);
    return NextResponse.json(
      { status: "degraded", db: "unreachable", checkedAt: new Date().toISOString() },
      { status: 503 }
    );
  }
}
