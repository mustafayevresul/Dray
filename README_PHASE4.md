# Phase 4 — Deployment & Go-Live

Three deployables, one shared database:

| Piece | Where it runs | What it is |
|---|---|---|
| `admin-web` | Vercel | The **entire backend** (every `/api/*` route) + the admin dashboard |
| `load-owner-web` | Vercel | Load Owner Panel — calls `admin-web`'s API over HTTPS |
| `driver-app` | EAS → App Store / Play Store | The driver's native app — also calls `admin-web`'s API |
| Postgres + Storage + Realtime | Supabase | One project, shared by all three |

`admin-web` is the single source of truth for business logic; the other two are pure clients. Keep it that way — don't let `load-owner-web` grow its own copy of trip/escrow logic.

## 1. Supabase — set up the database first

1. Create a project at supabase.com. Pick a region close to your users (e.g. `eu-central-1` for Azerbaijan/Turkey/Georgia/Russia traffic).
2. From **Project Settings → Database**, copy both connection strings:
   - **Connection pooling** (port 6543) → `DATABASE_URL`
   - **Direct connection** (port 5432) → `DIRECT_URL`
   (The schema's `datasource` block was missing `directUrl` until this audit — without it, `prisma migrate` tries to run through pgbouncer and fails outright.)
3. From the repo root:
   ```bash
   npm install
   cp .env.example .env   # fill in DATABASE_URL / DIRECT_URL
   npm run db:migrate:deploy
   ```
4. Open the **SQL Editor** in Supabase and run `supabase/setup.sql` — enables PostGIS, turns on Realtime for `ChatMessage`, creates the POD photo storage bucket.
5. From **Project Settings → API**, copy the `anon` public key and project URL — these go into `load-owner-web` and `driver-app`'s env files (never the `service_role` key, which is server-only and goes in `admin-web`'s env instead).
6. Seed one row so the dashboard's commission rate isn't null:
   ```sql
   insert into "PlatformConfig" (id, "commissionPct") values ('singleton', 0.07)
   on conflict (id) do nothing;
   ```

## 2. Vercel — two projects, one repo

Vercel doesn't need a monorepo tool here — just import the repo twice, pointed at different subdirectories.

**Project 1: `dray-admin`**
- Root Directory: `admin-web`
- Framework Preset: Next.js (auto-detected)
- **Settings → General → "Include files outside of the Root Directory in the Build Step" → ON.** This is not optional — `admin-web` imports `../lib/*` (the shared `tripStateMachine`, `matching`, `escrow`, `payments/`, `push.ts` modules) and without this toggle, Vercel's build never sees those files and every API route importing them 404s or fails to build.
- Environment Variables: everything in `admin-web/.env.example`, values filled in.
- Deploy. Note the resulting URL (or attach your own domain, e.g. `admin.dray.app`).

**Project 2: `dray-owner`**
- Root Directory: `load-owner-web`
- Same "Include files outside Root Directory" toggle → ON (this app reaches into the root `i18n/` folder for translations).
- Environment Variables: everything in `load-owner-web/.env.example`. **`NEXT_PUBLIC_API_BASE_URL` must be the `dray-admin` URL from the previous step.**
- Deploy. Attach a domain, e.g. `ship.dray.app`.

After both are live, hit `https://admin.dray.app/api/health` — should return `{"status":"ok","db":"connected",...}`. If it doesn't, stop here and fix the DB connection before going further.

## 3. Stripe — live mode + webhook

1. Switch your Stripe Dashboard to **Live mode** (top-left toggle).
2. **Developers → API keys**: copy the live secret and publishable keys into `admin-web`'s env vars; the publishable key also goes to `load-owner-web`'s `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
3. **Developers → Webhooks → Add endpoint**: URL = `https://admin.dray.app/api/webhooks/stripe`, events = `account.updated`, `setup_intent.succeeded`, `payment_intent.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. **Connect settings**: enable Express accounts if not already on by default for your Stripe account type — this is what `stripe-onboarding-link` creates for drivers.
5. Redeploy `admin-web` after adding these env vars (Vercel doesn't hot-reload env changes into a running deployment).

AZN trips don't touch Stripe at all — `lib/payments/localGatewayProvider.ts` is still a stub (see blockers below).

## 4. Driver app — EAS build & submit

```bash
cd driver-app
npm install -g eas-cli   # if not already installed
eas login
eas build:configure      # links this project to an EAS project, fills app.json's extra.eas.projectId
```

Fill in `driver-app/.env` (or set as EAS secrets — preferred for anything you don't want in git):
```bash
eas secret:create --name EXPO_PUBLIC_API_BASE_URL --value https://admin.dray.app
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value https://[project-ref].supabase.co
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value [anon-key]
```

Build and submit:
```bash
eas build --profile production --platform all
eas submit --profile production --platform all   # fill in eas.json's REPLACE_WITH_* fields first
```

Expo's push service needs no extra server config for the FCM/APNs routing `lib/push.ts` relies on — it's handled automatically once the app is built with a real `projectId`.

## 5. Post-deploy smoke test

Before telling any real user about this, walk the entire lifecycle once yourself:
1. `GET /api/health` → healthy.
2. Register a driver through the app → check the row landed in Supabase with `status: PENDING_VERIFICATION`.
3. Manually flip that driver to `ACTIVE` in Supabase's table editor (no admin UI for this yet — see blockers).
4. Send that driver a location ping (open the app, grant permissions) → confirm `Driver.locationUpdatedAt` updates.
5. Post a load via `load-owner-web` → confirm a `LoadOffer` row appears for that driver, and the driver app's offer feed shows it within ~6s.
6. Accept the offer → confirm `Trip.status` is `ASSIGNED` and an `EscrowTransaction` (`HELD`) exists.
7. Walk `LOADING → IN_TRANSIT` → submit a POD photo → confirm delivery from `load-owner-web` → confirm the trip reaches `COMPLETED` and the escrow `RELEASED`.
8. Send a chat message from both sides, confirm it arrives live (not just on refresh) — this is what proves the Supabase Realtime publication step actually worked.

If step 8 fails silently (message saves but never appears live), you skipped `alter publication supabase_realtime add table "ChatMessage"` in `supabase/setup.sql`.

## 6. Monitoring

Point an uptime monitor (UptimeRobot, Better Uptime, or Vercel's own Checks) at `/api/health` on a 1–5 minute interval. Wire Vercel's built-in error/log alerts for both projects — that's the fastest way to hear about a broken deploy before a driver does.

---

## 7. Go-Live Blockers — read this before inviting real users

Everything above makes the app **deployable and runnable**. It does not make it **safe to open to strangers**. These are real gaps, not nice-to-haves:

### 🔴 No authentication
Every API route trusts whatever `driverId`/`ownerId` the client sends — there is no session, token, or password check anywhere. `load-owner-web`'s pages literally hardcode `const CURRENT_OWNER_ID = "REPLACE_WITH_AUTHENTICATED_OWNER_ID"`. Right now, anyone who can guess or intercept an ID can act as that driver or load owner — read their messages, see their trips, and (for a load owner) trigger payment confirmations on their behalf.

**This is the single biggest blocker to a real launch.** Recommended minimal fix: Supabase Auth with phone OTP (matches `User.phone` already being the primary identifier) — a driver/owner logs in with their phone, gets a JWT, and every API route validates that JWT's subject matches the `driverId`/`ownerId` in the request instead of trusting it blindly. This is a meaningfully sized piece of work (every route needs a session check added), not a config change — treat it as its own phase before onboarding anyone outside your own test devices.

### 🟡 No admin approval workflow
Step 3 of the smoke test above — manually flipping a driver to `ACTIVE` in Supabase's table editor — is the *entire* verification workflow right now. There's no dashboard screen for ops to review a driver's submitted documents and approve/reject them. Fine for a handful of test drivers; not fine at any real volume.

### 🟡 AZN payments are a stub
`lib/payments/localGatewayProvider.ts` logs what it *would* do rather than calling a real gateway. Every AZN trip's escrow will sit in `HELD` state forever with no real money ever moving until a specific processor (Payriff, ePoint, Kapital Bank, etc.) is integrated. USD trips through Stripe are real and tested; AZN trips are not.

### 🟡 No re-broadcast on a failed payment hold
If a load owner's card fails at accept-time (`offers/accept` correctly returns a 402 rather than assigning the driver anyway — see the Phase 3 audit fix), the load just sits there with no driver and no automatic retry. Ops has to notice and manually re-trigger `broadcastLoadToNearbyDrivers` or ask the owner to fix their card and re-post.

### 🟡 Web push isn't real
`LoadOwner.webPushToken` assumes an Expo-style token. A browser needs an actual `PushManager` subscription + service worker to produce a real push token — until that's built, load owners simply don't get push notifications (driver push via Expo works fine).

### 🟢 RLS is not your safety net
`supabase/setup.sql` explains this in a comment, worth repeating here: every table is accessed through Prisma using the raw `DATABASE_URL` connection, which bypasses Postgres Row Level Security entirely. All authorization today lives in application code (each API route checking `trip.driverId === driverId`, etc.). This is fine *as an architecture*, but it means the "no authentication" blocker above is doing double duty — it's not just about login, it's the only thing that will ever stand between one driver and another driver's trip data.

**Bottom line:** this is a fully wired, end-to-end working system — a genuinely good foundation, not a toy — but it is a **staging/pilot-ready system, not a public-launch-ready one**, specifically because of authentication. Everything in sections 1–6 above is worth doing now so your pilot testers (a handful of real drivers and load owners you trust, on devices you control) can use it. Treat the blockers list as Phase 5.
