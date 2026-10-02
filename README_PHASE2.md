# Phase 2 — Load Owner Panel & Complete Trip Lifecycle

Builds directly on the Phase 1 schema and Next.js backend — no rewrites,
only additive models and routes.

## 1. What was added

| Module | Files |
|---|---|
| Schema | `prisma/schema.prisma` — extended `TripStatus`/`LoadStatus`, added `Currency`, `OfferStatus`, `EscrowStatus`, and models `LoadOffer`, `ProofOfDelivery`, `EscrowTransaction` |
| State machine | `lib/tripStateMachine.ts` — the **only** code path allowed to write `Trip.status` |
| Matching engine | `lib/matching.ts` — broadcasts a new load to nearby `FREE` drivers |
| Escrow | `lib/escrow.ts` — hold-on-assign, release-on-confirm, refund-on-cancel |
| Load Owner API | `admin-web/app/api/loads/route.ts` (create + list) |
| Trip lifecycle API | `admin-web/app/api/trips/[tripId]/{transition,pod,confirm-delivery,tracking}/route.ts` |
| Offer API | `admin-web/app/api/offers/[offerId]/accept/route.ts`, `admin-web/app/api/drivers/[driverId]/{offers,active-trip}/route.ts` |
| Load Owner web app | `load-owner-web/app/loads/new/page.tsx` (post shipment), `load-owner-web/app/trips/[tripId]/tracking/page.tsx` (live map + confirm delivery) |
| Driver app additions | `driver-app/screens/ActiveTripScreen.tsx`, `driver-app/screens/ProofOfDeliveryScreen.tsx`; `HomeScreen.tsx` and `services/api.ts` updated for the offer/accept flow |

`lib/` now sits at the project root (`freight-app/lib/`) since both
`admin-web` and `load-owner-web` import from it — set each app's
`tsconfig.json` path alias (`"@/lib/*": ["../lib/*"]`) or, simpler for
launch, keep both web apps inside one Next.js project with separate route
groups (`app/(admin)/dashboard`, `app/(owner)/loads/new`) so `@/lib/*`
resolves the same way everywhere. The README shows them as separate apps
for clarity of ownership; merging them is a 10-minute refactor either way.

## 2. How the pieces fit together (end-to-end flow)

1. **Load Owner posts a shipment** → `POST /api/loads`. This creates the
   `Load` *and* its `Trip` (status `SEARCHING`) in one transaction, snapshots
   the live commission rate from `PlatformConfig`, then immediately calls
   `broadcastLoadToNearbyDrivers()`.
2. **Matching engine** finds every `ACTIVE` driver whose truck fits the
   cargo, whose last GPS ping is fresh (`FREE`, per Phase 1's
   `driverAvailability.ts`), and who's within `SEARCH_RADIUS_KM` — creates
   one `LoadOffer` (status `PENDING`, 90s TTL) per driver.
3. **Driver app polls** `GET /drivers/:id/offers` every ~6s and shows the
   feed — this is what replaced Phase 1's simpler "browse nearby loads."
4. **First driver to accept** hits `POST /offers/:offerId/accept`. This is
   the one genuinely tricky bit of concurrency in Phase 2: the route
   re-checks the offer's status *inside* a DB transaction, so if two
   drivers tap Accept within milliseconds of each other, only one wins —
   the other gets a clean 409 "already assigned" response. Winning flips
   `Trip.status` to `ASSIGNED` (via the state machine) and opens the
   `EscrowTransaction` (status `HELD`).
5. **Driver advances the trip** through `POST /trips/:id/transition`
   (`ASSIGNED → LOADING → IN_TRANSIT`) as they progress — each step
   validated against `ALLOWED_TRANSITIONS`, so the app can't skip states.
6. **Load Owner watches live** on `/trips/:tripId/tracking`, which polls
   `GET /trips/:id/tracking` every 5s to re-plot the driver's last GPS ping
   (the same `Driver.lastLat/lastLng` Phase 1's background location service
   writes to — no new tracking mechanism needed).
7. **Driver submits Proof of Delivery** — `POST /trips/:id/pod` with a photo
   URL (uploaded client-side to object storage first). This flips the trip
   to `DELIVERED`.
8. **Load Owner confirms** — `POST /trips/:id/confirm-delivery`. This is the
   money moment: `Trip → COMPLETED`, `EscrowTransaction → RELEASED`,
   `commissionCents` is captured permanently (never recalculated later even
   if the platform's 6–8% rate changes), and the driver's
   `totalEarningsCents` is credited.

## 3. Design decisions worth knowing about

- **Offers, not direct assignment.** A load is broadcast to *many* drivers
  at once (Bolt/Uber pattern), not matched to a single "best" driver
  server-side. This needs the race-safe accept transaction in step 4, but
  gets drivers moving faster and doesn't require a perfect matching
  algorithm on day one.
- **Money math is snapshotted, not live.** `Trip.commissionPct`,
  `commissionCents`, and `driverPayoutCents` are all fixed the moment the
  load is posted. Admin can change `PlatformConfig.commissionPct` for
  *future* loads without ever touching historical trips' numbers.
- **Escrow here is a ledger, not a payment rail.** `EscrowTransaction`
  models the state (`HELD` → `RELEASED`/`REFUNDED`) that a real payment
  provider's manual-capture flow would drive. Stripe Connect maps onto this
  almost directly: `HELD` = authorize/hold, `RELEASED` = capture + transfer
  to the driver's connected account, `REFUNDED` = void the hold. Wiring
  that in is a Phase 3 item — right now `releaseEscrow()` just updates the
  ledger and the driver's running totals.
- **No cron jobs yet.** Offer expiry is checked lazily (on the next poll or
  accept attempt) rather than via a background worker — fine at Phase 2
  volume, worth revisiting once you have enough concurrent loads that
  stale offers materially reduce driver responsiveness.

## 4. What's intentionally left for Phase 3

- Real payment provider integration (Stripe Connect suggested above)
- Push notifications for new offers (currently short-poll)
- Delivery disputes / re-opening a `DELIVERED` trip if the owner rejects
  the POD photo instead of confirming
- Ratings (driver ↔ load owner) after `COMPLETED`
- Admin visibility into in-flight trips (Phase 1's dashboard only shows
  aggregate stats; a live trips table is a natural next admin screen)
