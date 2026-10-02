import { getAccessToken } from "./supabaseClient";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""; // same-origin if load-owner-web shares the Next.js backend

// Phase 5: every request now carries the current Supabase session's access
// token. The backend verifies it itself (lib/auth.ts) rather than trusting
// any ownerId this client claims — see the removed `ownerId` params below.
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

export type AuthMeResponse =
  | { registered: false; phone: string | null }
  | { registered: true; role: "DRIVER"; driverId: string; driverStatus: string }
  | { registered: true; role: "LOAD_OWNER"; ownerId: string };

// ownerId removed — the backend derives it from the token.
export type CreateLoadPayload = {
  pickupLat: number;
  pickupLng: number;
  pickupAddr: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddr: string;
  cargoType: string;
  cargoTons: number;
  requiredLengthM?: number;
  offeredRateCents: number;
  currency: "USD" | "AZN";
};

export type TrackingResponse = {
  tripStatus: string;
  pickup: { lat: number; lng: number; addr: string };
  dropoff: { lat: number; lng: number; addr: string };
  driver: {
    name: string;
    vehicle: string;
    phone: string;
    lat: number | null;
    lng: number | null;
    locationUpdatedAt: string | null;
  } | null;
};

export type ChatMessagePayload = {
  id: string;
  tripId: string;
  senderRole: "DRIVER" | "LOAD_OWNER";
  driverId: string | null;
  ownerId: string | null;
  body: string;
  sentAt: string;
  readAt: string | null;
};

export const api = {
  getMe: () => request<AuthMeResponse>("/api/auth/me"),

  registerLoadOwner: (fullName: string, companyName?: string) =>
    request<{ id: string }>("/api/load-owners/register", {
      method: "POST",
      body: JSON.stringify({ fullName, companyName }),
    }),

  createLoad: (payload: CreateLoadPayload) =>
    request<{ tripId: string; loadId: string; offersSent: number }>("/api/loads", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getTracking: (tripId: string) => request<TrackingResponse>(`/api/trips/${tripId}/tracking`),

  // ownerId param removed - derived server-side from the token.
  confirmDelivery: (tripId: string) =>
    request<{ status: string; commissionCapturedCents: number; driverPayoutCents: number }>(
      `/api/trips/${tripId}/confirm-delivery`,
      { method: "POST" }
    ),

  // ---- Phase 3: chat, push, payment setup ----

  getTripMessages: (tripId: string) => request<ChatMessagePayload[]>(`/api/trips/${tripId}/messages`),

  // senderRole/ownerId removed - derived server-side; only the text is sent.
  sendTripMessage: (tripId: string, body: string) =>
    request<ChatMessagePayload>(`/api/trips/${tripId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  registerPushToken: (ownerId: string, webPushToken: string) =>
    request<{ ok: true }>(`/api/load-owners/${ownerId}/push-token`, {
      method: "POST",
      body: JSON.stringify({ webPushToken }),
    }),

  getPaymentSetupUrl: (ownerId: string) =>
    request<{ clientSecret: string; publishableKey: string }>(
      `/api/load-owners/${ownerId}/setup-payment-method`,
      { method: "POST" }
    ),
};
