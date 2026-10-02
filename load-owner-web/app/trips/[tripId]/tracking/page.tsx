"use client";

import { useEffect, useState, useCallback } from "react";
import { api, TrackingResponse } from "@/lib/api";
import ChatPanel from "@/components/ChatPanel";
import { useTranslation } from "../../../../i18n/LocaleProvider";
import { TranslationKey } from "../../../../../i18n/translate";

const CHAT_ELIGIBLE_STATUSES = ["ASSIGNED", "LOADING", "IN_TRANSIT", "DELIVERED"];

const POLL_MS = 5000; // live map refresh cadence while a trip is active

// Phase 5: ownerId is derived server-side from the authenticated session.

const STATUS_KEY: Record<string, TranslationKey> = {
  SEARCHING: "tracking.statusSearching",
  ASSIGNED: "tracking.statusAssigned",
  LOADING: "tracking.statusLoading",
  IN_TRANSIT: "tracking.statusInTransit",
  DELIVERED: "tracking.statusDelivered",
  COMPLETED: "tracking.statusCompleted",
  CANCELLED: "tracking.statusCancelled",
};

export default function TripTrackingPage({ params }: { params: { tripId: string } }) {
  const { t } = useTranslation();
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.getTracking(params.tripId);
      setData(res);
    } catch {
      setError("Couldn't refresh tracking data.");
    }
  }, [params.tripId]);

  useEffect(() => {
    refresh();
    const isTerminal = data?.tripStatus === "COMPLETED" || data?.tripStatus === "CANCELLED";
    if (isTerminal) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, data?.tripStatus]);

  async function handleConfirm() {
    setConfirming(true);
    try {
      await api.confirmDelivery(params.tripId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm delivery.");
    } finally {
      setConfirming(false);
    }
  }

  if (!data) return <div className="p-8 text-slate-500">Loading trip…</div>;

  // Lightweight embedded map via Google Maps static/iframe embed — swap for
  // react-map-gl / @vis.gl/react-google-maps if you need custom markers,
  // route polylines, etc. Kept simple here to stay framework-agnostic.
  const mapCenter = data.driver?.lat && data.driver?.lng ? data.driver : data.pickup;
  const statusKey = STATUS_KEY[data.tripStatus];

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-bold text-slate-900">{t("tracking.title")}</h1>
      <p className="mt-1 text-sm font-medium text-slate-600">
        {statusKey ? t(statusKey) : data.tripStatus}
      </p>

      <div className="mt-5 aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        {mapCenter?.lat && mapCenter?.lng ? (
          <iframe
            title="trip-map"
            className="h-full w-full"
            src={`https://maps.google.com/maps?q=${mapCenter.lat},${mapCenter.lng}&z=11&output=embed`}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Waiting for driver location…
          </div>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-slate-400">{t("tracking.pickup")}</p>
          <p className="font-medium text-slate-800">{data.pickup.addr}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-slate-400">{t("tracking.dropoff")}</p>
          <p className="font-medium text-slate-800">{data.dropoff.addr}</p>
        </div>
      </div>

      {data.driver && (
        <div className="mt-4 rounded-lg border border-slate-200 p-4 text-sm">
          <p className="text-slate-400">{t("tracking.driver")}</p>
          <p className="font-medium text-slate-800">
            {data.driver.name} · {data.driver.vehicle}
          </p>
          {data.driver.locationUpdatedAt && (
            <p className="mt-1 text-xs text-slate-400">
              {t("tracking.lastSeen", { time: new Date(data.driver.locationUpdatedAt).toLocaleTimeString() })}
            </p>
          )}
        </div>
      )}

      {data.tripStatus === "DELIVERED" && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-medium text-amber-800">{t("tracking.deliveredBanner")}</p>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {confirming ? "…" : t("tracking.confirmButton")}
          </button>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {CHAT_ELIGIBLE_STATUSES.includes(data.tripStatus) && (
        <ChatPanel tripId={params.tripId} driverPhone={data.driver?.phone ?? null} />
      )}
    </div>
  );
}
