# Phase 5 — Authentication & Authorization

Every route is now identity-checked. This closes the 🔴 blocker from
`README_PHASE4.md` — nothing here changes deployment steps 1–6 in that
file, this adds to them.

## 1. Enable phone auth in Supabase

1. Supabase Dashboard → **Authentication → Providers → Phone** → enable it.
2. Supabase needs a real SMS provider to actually send codes — **Authentication → Providers → Phone → SMS Provider**, configure Twilio (or Vonage/MessageBird). Twilio's free trial is fine for pilot testing; you'll need a paid Twilio account with a purchased number before real drivers rely on this.
3. **Authentication → Settings**: consider lowering the OTP expiry window and rate limits from Supabase's defaults for a phone-heavy consumer app — the defaults are tuned for lower-volume use.
4. Add to `admin-web`'s env (already in `.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Add to both `load-owner-web` and `driver-app`'s env: `*_SUPABASE_URL`, `*_SUPABASE_ANON_KEY` (already templated, just fill in real values).

## 2. How the security model actually works

```
Client (driver-app / load-owner-web)
  1. supabase.auth.signInWithOtp({ phone })         -- Supabase sends the SMS
  2. supabase.auth.verifyOtp({ phone, token })       -- returns a session (JWT)
  3. Every API call attaches Authorization: Bearer <access_token>

Backend (admin-web, lib/auth.ts)
  1. supabaseAdmin.auth.getUser(token)               -- asks Supabase "whose token is this?"
  2. db.user.findUnique({ where: { authUserId } })   -- resolves to OUR Driver/LoadOwner row
  3. If the route has a :driverId/:ownerId param, confirm it matches      -- 403 if not
```

**Nothing about a caller's identity is ever trusted from the request body or URL alone.** A `driverId` in a URL is only ever used to confirm it matches what the *token* resolves to — it's never the source of truth by itself. This is what closes the two most severe bugs found in the Phase 4/5 audits:
- `/api/offers/:offerId/accept` used to have **no identity check whatsoever** — any request could accept any driver's offer.
- `/api/trips/:tripId/transition` and `/api/trips/:tripId/tracking` were similarly open — any request could advance any trip's status, or watch any driver's live GPS position and see their phone number.

## 3. What changed in each app

**Schema**: `User.authUserId` (unique, nullable only for pre-Phase-5 rows) links our `User` table to Supabase's `auth.users`. `passwordHash` was removed entirely — phone OTP replaces it, there's no password anywhere in this system.

**Backend (`lib/auth.ts`)**: the single module every protected route imports from. `requireDriver(req, routeDriverId?)`, `requireLoadOwner(req, routeOwnerId?)`, `requireDriverOrLoadOwner(req)` (for chat, where either role may call), and the `authErrorResponse(err)` helper every route's catch block uses to turn an `AuthError` into the right 401/403.

**Two new endpoints**: `POST /api/load-owners/register` (didn't exist before — load-owner-web had no signup flow at all) and `GET /api/auth/me` (tells a freshly-verified client whether a Driver/LoadOwner profile already exists, and which).

**driver-app**: `App.tsx` now runs a real state machine — `PhoneEntryScreen → OtpVerifyScreen → (RegistrationScreen | HomeScreen)` — driven by Supabase session state, not a locally-cached driverId. `services/supabaseClient.ts` is the one Supabase client instance for the whole app (Auth + Realtime chat share it now, rather than `chat.ts` creating its own throwaway client with no session).

**load-owner-web**: `lib/AuthProvider.tsx` (React context) + `components/AuthGate.tsx` (phone/OTP/registration UI) wrap the entire app in `layout.tsx` — no page is reachable without a signed-in session. The `CURRENT_OWNER_ID = "REPLACE_WITH_AUTHENTICATED_OWNER_ID"` placeholder that used to sit in two pages is gone; `ownerId` now comes from the real session everywhere.

**Every client-supplied identity field was removed from request bodies**: `POST /api/loads` no longer takes `ownerId`, `POST /api/trips/:id/pod` no longer takes `driverId`, `POST /api/trips/:id/messages` no longer takes `senderRole`/`driverId`/`ownerId`, `POST /api/trips/:id/confirm-delivery` no longer takes `ownerId`. All derived from the bearer token instead.

## 4. The one remaining stopgap: the admin dashboard

There is still no real per-admin login (no Supabase Auth flow for the `AdminUser` role, no session, nothing). `/api/stats` is gated by a single shared secret (`ADMIN_API_KEY`) checked via an `x-admin-key` header — the dashboard prompts for it once per browser tab and holds it in `sessionStorage`. This is explicitly a stopgap, documented as such in `lib/auth.ts`. Fine for one or two trusted people; replace with a real admin login before giving dashboard access to a larger ops team.

## 5. Updated go-live blockers (see `README_PHASE4.md` §7 for the full original list)

- ~~🔴 No authentication~~ — **closed by this phase.**
- 🟡 No admin approval workflow — unchanged, still a manual Supabase table-editor flip.
- 🟡 AZN payments are a stub — unchanged.
- 🟡 No re-broadcast on a failed payment hold — unchanged.
- 🟡 Web push isn't real — unchanged.
- 🟢 RLS is not your safety net — **this is now less of a concern**: application-layer auth checks are exactly what RLS would otherwise provide, and every route has one. RLS is still worth adding as defense-in-depth eventually, but it's no longer the *only* thing standing between users.
- 🆕 Admin dashboard auth is a shared-secret stopgap, not real per-user login — see §4 above.

This is now genuinely closer to launch-ready for a controlled pilot than "staging-only." The admin dashboard stopgap and the AZN/local-gateway stub remain the two things most worth prioritizing next.
