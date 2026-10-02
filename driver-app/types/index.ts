// Phase 5: `phone` removed — the phone number is established during OTP
// verification (PhoneEntryScreen/OtpVerifyScreen) before this form is ever
// shown, and the backend derives it from the verified session token rather
// than trusting a resubmitted value here.
export type DriverRegistrationInput = {
  fullName: string;
  licenseNumber: string;
  plateNumber: string;
  truckBrand: string;
  truckModel: string;
  truckLengthM: number;
  maxCapacityTons: number;
};

// PHASE 2 — a pending dispatch offer, as broadcast by the matching engine.
// (An earlier "browse open loads" design used a NearbyLoad type + a
// /drivers/:id/nearby-loads endpoint; that was superseded by this
// broadcast/offer model before the endpoint was ever built, and has been
// removed to avoid dead code pointing at a route that doesn't exist.)
export type PendingOffer = {
  offerId: string;
  tripId: string;
  distanceKm: number;
  expiresAt: string;
  load: {
    pickupAddr: string;
    dropoffAddr: string;
    cargoType: string;
    cargoTons: number;
    offeredRateCents: number;
    currency: "USD" | "AZN";
    pickupLat: number;
    pickupLng: number;
  };
};

export type ActiveTrip = {
  id: string;
  status: "ASSIGNED" | "LOADING" | "IN_TRANSIT" | "DELIVERED" | "COMPLETED";
  pickupAddr: string;
  dropoffAddr: string;
  driverPayoutCents: number;
  currency: "USD" | "AZN";
  ownerPhone: string;
};

export type LatLng = {
  latitude: number;
  longitude: number;
};
