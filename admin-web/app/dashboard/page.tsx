"use client";

import { useEffect, useState, useCallback } from "react";
import { StatCard } from "@/components/StatCard";

type StatsResponse = {
  activeDriversOnline: number;
  totalDrivers: number;
  totalLoadOwners: number;
  successfulMatches: number;
  platformRevenue: {
    totalCents: number;
    todayCents: number;
    totalGrossFreightCents: number;
    currentCommissionPct: number;
  };
  generatedAt: string;
};

const REFRESH_INTERVAL_MS = 15_000; // dashboard should feel "live" without hammering the DB
const ADMIN_KEY_SESSION_STORAGE_KEY = "dray_admin_key";

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminKey, setAdminKey] = useState<string | null>(null);

  // Stopgap auth (see lib/auth.ts's requireAdminApiKey comment) — there's
  // no real per-admin login yet, so this page asks once for the shared
  // ADMIN_API_KEY and keeps it in sessionStorage (cleared when the tab
  // closes) rather than baking it into a NEXT_PUBLIC_ build-time constant,
  // which would ship it to every visitor's browser bundle regardless of
  // whether they ever open the dashboard.
  useEffect(() => {
    const stored = sessionStorage.getItem(ADMIN_KEY_SESSION_STORAGE_KEY);
    if (stored) {
      setAdminKey(stored);
      return;
    }
    const entered = window.prompt("Admin key required to view this dashboard:");
    if (entered) {
      sessionStorage.setItem(ADMIN_KEY_SESSION_STORAGE_KEY, entered);
      setAdminKey(entered);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    if (!adminKey) return;
    try {
      const res = await fetch("/api/stats", {
        cache: "no-store",
        headers: { "x-admin-key": adminKey },
      });
      if (res.status === 401) {
        sessionStorage.removeItem(ADMIN_KEY_SESSION_STORAGE_KEY);
        setError("Admin key rejected — refresh the page to re-enter it.");
        setAdminKey(null);
        return;
      }
      if (!res.ok) throw new Error("Request failed");
      const data: StatsResponse = await res.json();
      setStats(data);
      setError(null);
    } catch {
      setError("Couldn't refresh live stats. Retrying...");
    }
  }, [adminKey]);

  useEffect(() => {
    if (!adminKey) return;
    fetchStats();
    const id = setInterval(fetchStats, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [adminKey, fetchStats]);

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Platform Overview</h1>
          <p className="text-sm text-slate-500">
            Live operational metrics · auto-refreshes every 15s
          </p>
        </div>
        {stats && (
          <span className="text-xs text-slate-400">
            Updated {new Date(stats.generatedAt).toLocaleTimeString()}
          </span>
        )}
      </header>

      {error && (
        <div className="mb-6 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Drivers Online"
          value={stats ? stats.activeDriversOnline.toLocaleString() : "—"}
          sublabel={stats ? `of ${stats.totalDrivers.toLocaleString()} registered` : undefined}
          accent="green"
        />
        <StatCard
          label="Registered Load Owners"
          value={stats ? stats.totalLoadOwners.toLocaleString() : "—"}
          accent="blue"
        />
        <StatCard
          label="Successful Matches"
          value={stats ? stats.successfulMatches.toLocaleString() : "—"}
          sublabel="Completed trips, all-time"
          accent="violet"
        />
        <StatCard
          label="Platform Revenue"
          value={stats ? formatMoney(stats.platformRevenue.totalCents) : "—"}
          sublabel={
            stats
              ? `${formatMoney(stats.platformRevenue.todayCents)} today · ${(
                  stats.platformRevenue.currentCommissionPct * 100
                ).toFixed(1)}% commission`
              : undefined
          }
          accent="amber"
        />
      </div>

      {stats && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
          Gross freight value moved through the platform:{" "}
          <span className="font-semibold text-slate-800">
            {formatMoney(stats.platformRevenue.totalGrossFreightCents)}
          </span>{" "}
          — commission is calculated per-trip at match time (see{" "}
          <code className="rounded bg-slate-100 px-1">PlatformConfig.commissionPct</code>,
          tunable 6–8%).
        </div>
      )}
    </div>
  );
}
