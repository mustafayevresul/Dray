"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, CreateLoadPayload } from "@/lib/api";
import { useTranslation } from "../../../i18n/LocaleProvider";

// Phase 5: ownerId is derived server-side from the authenticated session
// (see lib/api.ts / lib/auth.ts) — no placeholder id needed here anymore.

type FormState = {
  pickupAddr: string;
  pickupLat: string;
  pickupLng: string;
  dropoffAddr: string;
  dropoffLat: string;
  dropoffLng: string;
  cargoType: string;
  cargoTons: string;
  requiredLengthM: string;
  offeredRate: string;
  currency: "USD" | "AZN";
};

const initialState: FormState = {
  pickupAddr: "",
  pickupLat: "",
  pickupLng: "",
  dropoffAddr: "",
  dropoffLat: "",
  dropoffLng: "",
  cargoType: "",
  cargoTons: "",
  requiredLengthM: "",
  offeredRate: "",
  currency: "USD",
};

export default function NewLoadPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ offersSent: number; tripId: string } | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: CreateLoadPayload = {
        pickupAddr: form.pickupAddr,
        pickupLat: Number(form.pickupLat),
        pickupLng: Number(form.pickupLng),
        dropoffAddr: form.dropoffAddr,
        dropoffLat: Number(form.dropoffLat),
        dropoffLng: Number(form.dropoffLng),
        cargoType: form.cargoType,
        cargoTons: Number(form.cargoTons),
        requiredLengthM: form.requiredLengthM ? Number(form.requiredLengthM) : undefined,
        offeredRateCents: Math.round(Number(form.offeredRate) * 100),
        currency: form.currency,
      };
      const res = await api.createLoad(payload);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post load");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
          <h2 className="text-lg font-semibold text-emerald-800">{t("loadForm.published")}</h2>
          <p className="mt-2 text-sm text-emerald-700">
            {t("loadForm.broadcastResult", { count: result.offersSent })}
          </p>
          <button
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            onClick={() => router.push(`/trips/${result.tripId}/tracking`)}
          >
            {t("loadForm.trackShipment")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold text-slate-900">{t("loadForm.title")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("loadForm.subtitle")}</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-700">{t("loadForm.origin")}</legend>
          <input
            required
            placeholder={t("loadForm.pickupAddress")}
            className="input"
            value={form.pickupAddr}
            onChange={(e) => update("pickupAddr", e.target.value)}
          />
          <div className="flex gap-3">
            <input
              required
              placeholder="Latitude"
              className="input"
              value={form.pickupLat}
              onChange={(e) => update("pickupLat", e.target.value)}
            />
            <input
              required
              placeholder="Longitude"
              className="input"
              value={form.pickupLng}
              onChange={(e) => update("pickupLng", e.target.value)}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-700">{t("loadForm.destination")}</legend>
          <input
            required
            placeholder={t("loadForm.dropoffAddress")}
            className="input"
            value={form.dropoffAddr}
            onChange={(e) => update("dropoffAddr", e.target.value)}
          />
          <div className="flex gap-3">
            <input
              required
              placeholder="Latitude"
              className="input"
              value={form.dropoffLat}
              onChange={(e) => update("dropoffLat", e.target.value)}
            />
            <input
              required
              placeholder="Longitude"
              className="input"
              value={form.dropoffLng}
              onChange={(e) => update("dropoffLng", e.target.value)}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-700">{t("loadForm.cargo")}</legend>
          <input
            required
            placeholder={t("loadForm.cargoType")}
            className="input"
            value={form.cargoType}
            onChange={(e) => update("cargoType", e.target.value)}
          />
          <div className="flex gap-3">
            <input
              required
              placeholder={t("loadForm.weightTons")}
              className="input"
              value={form.cargoTons}
              onChange={(e) => update("cargoTons", e.target.value)}
            />
            <input
              placeholder={t("loadForm.requiredLength")}
              className="input"
              value={form.requiredLengthM}
              onChange={(e) => update("requiredLengthM", e.target.value)}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-700">{t("loadForm.offeredRate")}</legend>
          <div className="flex gap-3">
            <input
              required
              placeholder="Amount"
              className="input"
              value={form.offeredRate}
              onChange={(e) => update("offeredRate", e.target.value)}
            />
            <select
              className="input"
              value={form.currency}
              onChange={(e) => update("currency", e.target.value as "USD" | "AZN")}
            >
              <option value="USD">USD ($)</option>
              <option value="AZN">AZN (₼)</option>
            </select>
          </div>
        </fieldset>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? "…" : t("loadForm.publishButton")}
        </button>
      </form>

      <style jsx global>{`
        .input {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 14px;
        }
      `}</style>
    </div>
  );
}
