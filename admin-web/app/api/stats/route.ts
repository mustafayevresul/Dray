import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { GPS_FRESHNESS_WINDOW_MS } from "@/lib/driverAvailability";
import { requireAdminApiKey, authErrorResponse } from "@/lib/auth";

// GET /api/stats
// Powers the top-line cards on the Admin Dashboard.
// Kept as one endpoint (rather than 4 separate calls) so the dashboard
// renders from a single consistent snapshot instead of 4 slightly
// different points in time.
//
// Phase 5: gated by requireAdminApiKey — a stopgap shared-secret check
// (see lib/auth.ts's comment on it) since there's no real per-admin login
// system yet. Was fully public before this.
export async function GET(req: NextRequest) {
  try {
    requireAdminApiKey(req);

    const freshCutoff = new Date(Date.now() - GPS_FRESHNESS_WINDOW_MS);

    const [
      activeDriversOnline,
      totalLoadOwners,
      totalDrivers,
      successfulMatches,
      revenueAgg,
      todayRevenueAgg,
      config,
    ] = await Promise.all([
      db.driver.count({
        where: { locationUpdatedAt: { gte: freshCutoff }, status: "ACTIVE" },
      }),
      db.loadOwner.count(),
      db.driver.count(),
      db.trip.count({ where: { status: "COMPLETED" } }),
      db.trip.aggregate({
        where: { status: "COMPLETED" },
        _sum: { commissionCents: true, freightPriceCents: true },
      }),
      db.trip.aggregate({
        where: {
          status: "COMPLETED",
          completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
        _sum: { commissionCents: true },
      }),
      db.platformConfig.findUnique({ where: { id: "singleton" } }),
    ]);

    return NextResponse.json({
      activeDriversOnline,
      totalDrivers,
      totalLoadOwners,
      successfulMatches,
      platformRevenue: {
        totalCents: revenueAgg._sum.commissionCents ?? 0,
        todayCents: todayRevenueAgg._sum.commissionCents ?? 0,
        totalGrossFreightCents: revenueAgg._sum.freightPriceCents ?? 0,
        currentCommissionPct: config?.commissionPct ?? 0.07,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("[/api/stats] failed:", err);
    return NextResponse.json(
      { error: "Failed to load platform statistics" },
      { status: 500 }
    );
  }
}
