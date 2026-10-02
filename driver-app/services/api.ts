import { DriverRegistrationInput, LatLng, PendingOffer, ActiveTrip } from "../types";
import { SupportedLocale } from "../../i18n/translate";
import { ChatMessage } from "./chat";
import { getAccessToken } from "./supabaseClient";

// Points at the admin-web deployment, which hosts every backend route this
// app calls (both admin-web and load-owner-web share one Next.js API
// surface under /api/*).
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://admin.dray.app";

// Phase 5: every authenticated request now carries the current Supabase
// session's access token. Every protected route on the backend verifies
// this token itself (lib/auth.ts) rather than trusting any id the request
// body or URL supplies — this header is what makes that possible.
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

export const api = {
  // Called right after OTP verification to check whether this phone
  // already has a Driver profile — decides RegistrationScreen vs HomeScreen.
  getMe: () => request<AuthMeResponse>("/api/auth/me"),

  registerDriver: (payload: DriverRegistrationInput) =>
    request<{ id: string }>("/api/drivers/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Called silently by the background location service — NOT by any
  // user-facing "I'm available" button. This single call is what keeps
  // the driver visible in the matching pool.
  pingLocation: (driverId: string, coords: LatLng, heading?: number, speedKph?: number) =>
    request<{ ok: true }>(`/api/drivers/${driverId}/location`, {
      method: "POST",
      body: JSON.stringify({ ...coords, heading, speedKph }),
    }),

  // ---- Phase 2: dispatch offers + trip lifecycle ----

  getPendingOffers: (driverId: string) => request<PendingOffer[]>(`/api/drivers/${driverId}/offers`),

  getActiveTrip: (driverId: string) => request<ActiveTrip | null>(`/api/drivers/${driverId}/active-trip`),

  acceptOffer: (offerId: string) =>
    request<{ tripId: string; status: string }>(`/api/offers/${offerId}/accept`, { method: "POST" }),

  transitionTrip: (tripId: string, to: "LOADING" | "IN_TRANSIT" | "CANCELLED") =>
    request<{ tripId: string; status: string }>(`/api/trips/${tripId}/transition`, {
      method: "POST",
      body: JSON.stringify({ to }),
    }),

  // driverId param removed - the backend now resolves it from the token.
  submitProofOfDelivery: (tripId: string, photoUrl: string, notes?: string) =>
    request<{ tripId: string; status: string }>(`/api/trips/${tripId}/pod`, {
      method: "POST",
      body: JSON.stringify({ photoUrl, notes }),
    }),

  // ---- Phase 3: i18n, chat, push ----

  updateDriverLocale: (driverId: string, locale: SupportedLocale) =>
    request<{ ok: true }>(`/api/drivers/${driverId}/locale`, {
      method: "POST",
      body: JSON.stringify({ locale: locale.toUpperCase() }),
    }),

  registerPushToken: (driverId: string, expoPushToken: string) =>
    request<{ ok: true }>(`/api/drivers/${driverId}/push-token`, {
      method: "POST",
      body: JSON.stringify({ expoPushToken }),
    }),

  getTripMessages: (tripId: string) => request<ChatMessage[]>(`/api/trips/${tripId}/messages`),

  // senderRole/driverId params removed - the backend derives both from
  // the token now; the client only ever supplies the message text.
  sendTripMessage: (tripId: string, body: string) =>
    request<ChatMessage>(`/api/trips/${tripId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  // ---- Phase 4: Stripe Connect onboarding (USD-payable drivers only) ----

  getStripeOnboardingLink: (driverId: string, refreshUrl: string, returnUrl: string) =>
    request<{ url: string }>(`/api/drivers/${driverId}/stripe-onboarding-link`, {
      method: "POST",
      body: JSON.stringify({ refreshUrl, returnUrl }),
    }),
};
