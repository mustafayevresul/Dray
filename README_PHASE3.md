# Phase 3 — i18n, Real-Time Chat, Push Notifications, Payment Wiring

Builds on Phases 1 & 2 without touching their core flow — the trip state
machine, matching engine, and escrow ledger all work exactly as before.
Phase 3 adds translation, live communication, notifications, and wires the
escrow ledger to money that actually moves.

## 1. What was added

| Module | Files |
|---|---|
| Schema | `Locale`, `PaymentProviderType`, `ChatSenderRole` enums; `ChatMessage` model; push/payment fields on `Driver` (`locale`, `expoPushToken`, `stripeAccountId`, `stripeOnboarded`) and `LoadOwner` (`locale`, `webPushToken`, `stripeCustomerId`); `provider`/`providerIntentId`/`providerTransferId`/`providerRefundId` on `EscrowTransaction` |
| i18n engine | `i18n/translate.ts` (core lookup, framework-agnostic), `i18n/locales/{en,az,tr,ru,ka}.json` (90 identical keys each), `driver-app/i18n/LocaleProvider.tsx` + `LanguageSelector.tsx`, `load-owner-web/i18n/LocaleProvider.tsx` + `LanguageSelect` |
| Chat | `admin-web/app/api/trips/[tripId]/messages/route.ts` (REST history + send), `driver-app/services/chat.ts` + `screens/ChatScreen.tsx`, `load-owner-web/lib/chat.ts` + `components/ChatPanel.tsx` — both sides use Supabase Realtime for live delivery |
| Push | `lib/push.ts` (Expo push service, FCM/APNs-ready), device-token registration routes for both driver and load owner, wired into `lib/matching.ts` (new offer), `transition` and `pod` routes (IN_TRANSIT/DELIVERED), `confirm-delivery` (payment released) |
| Payments | `lib/payments/{types,stripeProvider,localGatewayProvider,index}.ts`, rewritten `lib/escrow.ts`, Stripe onboarding-link route (driver), payment-method setup route (owner), Stripe webhook handler |

## 2. i18n — how it actually works

`i18n/translate.ts` is deliberately dependency-free (no i18next) so the
exact same module imports cleanly into both a Metro (React Native) bundle
and a Next.js bundle. `TranslationKey` is derived from `en.json`'s shape at
the **type** level, so `t("driverHome.offersTitle")` autocompletes and a
typo'd key is a compile error, not a silently blank string at runtime.

All 5 locale files are verified to have **identical key paths** — checked
programmatically while building this (`90 keys` each, same paths, not just
same count). Keep that invariant every time you add a key: add it to
`en.json` first, then to all four others before shipping, or `t()` will
silently fall back to English for whichever locale you missed (a safe
failure mode, but worth catching in review, not in production).

Azerbaijani (`az`) is `DEFAULT_LOCALE` — used whenever a device's locale
isn't one of the 5 supported. Georgian uses the ISO 639-1 code `ka`
(not `ge`, which is Germany's country code) — the schema's `Locale` enum
value is `KA` to match.

**Both `LocaleProvider`s persist the choice** (AsyncStorage on mobile,
`localStorage` on web) and call `PATCH /drivers/:id/locale` /
`/load-owners/:id/locale` so server-generated copy — specifically push
notification titles/bodies — renders in the same language, not just
in-app screens.

## 3. Chat — architecture and why Realtime, not polling

`ChatMessage` rows are written via a normal REST POST
(`/api/trips/:tripId/messages`), same pattern as everything else in this
app. But **new messages arrive via Supabase Realtime**, not polling:
`driver-app/services/chat.ts` and `load-owner-web/lib/chat.ts` both
subscribe to Postgres `INSERT` events on the `ChatMessage` table, filtered
to one trip.

**This requires one manual step Prisma migrations won't do for you** —
enable the table for Realtime in Supabase:
```sql
alter publication supabase_realtime add table "ChatMessage";
```

Chat is scoped to `ASSIGNED..DELIVERED` trip statuses only (enforced
server-side in the POST route) — there's no counterpart to talk to before
a driver is assigned, and nothing left to coordinate once a trip is
`COMPLETED`.

The **call trigger** is intentionally not a chat feature at all — it's a
plain `tel:` link (`Linking.openURL` on mobile, an `<a href="tel:">` on
web) using the phone number already on `User.phone`. No calling
infrastructure (Twilio, etc.) needed for Phase 3; that becomes relevant
only if you later want in-app masked/anonymous calling.

## 4. Push notifications

`lib/push.ts` uses **Expo's push service** rather than talking to Firebase
Admin directly. Since the driver app is Expo-managed, one Expo push token
covers both Android (routed through FCM) and iOS (routed through APNs)
without this codebase ever holding Firebase service-account credentials.
If you eject from Expo later, or want a non-Expo tool to also send
notifications, swap the internals of `dispatch()` for
`firebase-admin`'s `messaging().send()` — every call site
(`sendPushToDriver`, `sendPushToLoadOwner`, `sendPushToManyDrivers`) keeps
the same signature.

**Web push is the one real gap.** `LoadOwner.webPushToken` currently
assumes an Expo token (same as the driver app) — fine if the Load Owner
Panel ever ships as a companion mobile app, but the web app built in
Phase 2 needs an actual browser push subscription (`PushManager` API +
a service worker) feeding a Web Push sender (e.g. the `web-push` npm
package) instead. `sendPushToLoadOwner`'s body has a comment marking
exactly where that split needs to happen — left as one function for
Phase 3 clarity since the owner app's long-term platform (web vs. native)
isn't locked in yet.

**Notification trigger points**, all fire-and-forget (a failed push never
fails the underlying trip/offer operation):
- New offer broadcast → `sendPushToManyDrivers` (`lib/matching.ts`)
- Trip → `IN_TRANSIT` → `sendPushToLoadOwner` (`transition` route)
- Trip → `DELIVERED` (POD submitted) → `sendPushToLoadOwner` (`pod` route)
- Trip → `COMPLETED` (payment released) → `sendPushToDriver` (`confirm-delivery` route)

## 5. Payment wiring — the part that actually moves money

### Why two providers
Stripe does not settle Azerbaijani manat. Since Phase 2 already lets a
Load Owner price a shipment in either USD or AZN, Phase 3 needs two
payment rails from day one, not as a future migration:

- **USD → Stripe Connect** (`lib/payments/stripeProvider.ts`), manual-capture
  PaymentIntents against the owner's saved card, `application_fee_amount`
  for the platform commission, `transfer_data.destination` sending the rest
  straight to the driver's Connect Express account in the same capture call.
- **AZN → a local gateway** (`lib/payments/localGatewayProvider.ts`) — a
  clearly-marked **integration stub**. In Azerbaijan, Payriff, ePoint, and
  Kapital Bank's merchant API are common choices; none typically offer
  Stripe-Connect-style automatic marketplace splits, so the stub's comments
  note that driver payout there is likely a manual/ops-triggered bank
  transfer rather than something the API does for you — `providerTransferId`
  still gets set regardless, so the ledger looks the same either way.

Both implement the exact same `PaymentProvider` interface
(`lib/payments/types.ts`), and `resolvePaymentProvider(trip.currency)`
(`lib/payments/index.ts`) is the **only** place currency ever decides which
rail runs. `lib/escrow.ts` calls the interface, never a specific provider —
adding a third gateway later (say, for a new market's currency) means
implementing the interface once, nothing else in the app changes.

### The escrow lifecycle, now with real money behind it
```
Trip -> ASSIGNED   : provider.createHold()        -> EscrowTransaction(HELD)
Trip -> COMPLETED  : provider.captureAndPayout()   -> EscrowTransaction(RELEASED)
Trip -> CANCELLED  : provider.voidHold()           -> EscrowTransaction(REFUNDED)
```

### Two ordering bugs fixed while wiring this up
Both were present in the Phase 2 code and only became load-bearing once
real payment calls were added:

1. **`offers/[offerId]/accept`** used to transition the trip to `ASSIGNED`
   *before* opening the escrow hold. Fixed: the hold is now placed first;
   if the load owner's card is declined, the accept fails cleanly (`402`)
   instead of leaving a driver assigned to a load that can never pay out.
2. **`trips/[tripId]/confirm-delivery`** used to mark the trip `COMPLETED`
   *before* releasing escrow. Fixed: `releaseEscrow()` (the real Stripe/
   local-gateway capture) now runs first — a trip is only ever marked
   `COMPLETED` once money has actually moved. `releaseEscrow` is idempotent,
   so retrying after a crash between capture and the `COMPLETED` write is
   always safe.

### Onboarding, before any of this can run
- **Drivers** (USD trips only): `POST /drivers/:driverId/stripe-onboarding-link`
  creates a Stripe Connect Express account on first call, returns a
  Stripe-hosted onboarding URL. Open it in an in-app browser
  (`expo-web-browser`), not a WebView — Stripe blocks being framed.
  `Driver.stripeOnboarded` flips to `true` via the `account.updated`
  webhook once Stripe confirms the account can receive transfers.
- **Load Owners** (USD trips only): `POST /load-owners/:ownerId/setup-payment-method`
  creates a Stripe Customer + SetupIntent; the web app collects the card
  with Stripe Elements client-side and confirms the SetupIntent. The
  `setup_intent.succeeded` webhook attaches the card as the customer's
  default payment method — that's what `createHold()`'s off-session charge
  bills later.
- **AZN-only participants never touch Stripe** — no onboarding step exists
  yet for the local gateway beyond what `localGatewayProvider.ts`'s TODOs
  describe; that's the next concrete piece of work once a specific gateway
  is chosen.

### Webhook (`/api/webhooks/stripe`)
Required because onboarding and card setup both finish on Stripe-hosted
pages, outside this app's request/response cycle:
- `account.updated` → flips `Driver.stripeOnboarded`
- `setup_intent.succeeded` → attaches the owner's default payment method
- `payment_intent.payment_failed` → reconciles the ledger (`refundEscrow`)
  if a hold's authorization fails; does **not** make trip-lifecycle
  decisions (re-broadcasting a load after a failed hold is a Phase 4 item)

Register the endpoint in the Stripe Dashboard, or locally via:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Required env vars: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`, plus the existing `DATABASE_URL`,
`EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` (driver app),
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` (owner web app).

## 6. A known base-URL inconsistency, carried from Phase 2

`load-owner-web/lib/api.ts` calls paths prefixed with `/api/...` (correct,
since it's the same Next.js app as the routes). `driver-app/services/api.ts`
calls bare paths like `/drivers/:id/offers` with no `/api` prefix — meaning
`EXPO_PUBLIC_API_BASE_URL` needs to already include the `/api` segment
(e.g. `https://your-domain.com/api`), or the two web apps need to be
merged into one deployment with route groups as suggested in
`README_PHASE2.md`. Not a Phase 3 bug, just worth resolving explicitly
before this goes to a real device — pick one convention and apply it
everywhere rather than leaving base-URL configuration to compensate silently.

## 7. What's intentionally left for Phase 4

- Web Push for the Load Owner Panel (see section 4)
- A concrete local-gateway integration for AZN (Payriff/ePoint/Kapital Bank)
- Re-broadcast logic for a load whose assigned driver's payment hold fails
- Chat notifications for a backgrounded app (currently relies on the
  recipient's screen being open for Realtime delivery)
- Ratings, disputes, and admin visibility into in-flight trips (still
  carried over from the Phase 2 list — not yet addressed)
