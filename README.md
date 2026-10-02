# Freight Matching Platform — Phase 1

Admin Panel + Independent Driver Panel. Architected to plug directly into
Phase 2 (Load Owner app, live trip tracking, payments) without rework.

## 1. Recommended Stack

| Layer | Choice | Why |
|---|---|---|
| Mobile (Driver App) | **React Native + Expo (EAS)** | Background location (`expo-location` + `expo-task-manager`) is first-class, OTA updates avoid App Store waits for bug fixes, one codebase for iOS/Android. |
| Admin Dashboard | **Next.js 14 (App Router)** | Server components for fast initial stat loads, API routes double as your internal admin API, easy to deploy on Vercel. |
| Backend/API | **Node.js**, exposed via Next.js API routes (admin) + a dedicated Express/Fastify service or Next API routes (driver mobile) | Keeps one language across the stack; split into a separate service later if load matching needs its own scaling profile. |
| Database | **PostgreSQL via Supabase** | Native PostGIS support for geo-radius queries (critical for "nearby loads"), built-in auth, realtime subscriptions you can use later for live trip tracking, row-level security for load-owner/driver data isolation. |
| ORM | **Prisma** | Type-safe schema shared conceptually across admin and mobile backend, easy migrations. |
| Maps | **react-native-maps** (mobile), **Mapbox/Google Maps JS** (admin, if you add a live driver map later) | Mature, works with Expo. |
| Realtime driver pings | **Supabase Realtime** or a lightweight WebSocket layer | For Phase 2 live trip tracking; Phase 1 uses simple REST polling, which is enough for GPS pings every 60s. |

## 2. Geo-matching note (important, not yet in schema code)

`driver.lastLat/lastLng` and `load.pickupLat/pickupLng` are stored as plain
floats for Phase 1 simplicity. For production-grade "nearby load" queries,
enable the **PostGIS** extension in Supabase and switch these to a
`geography(Point)` column with a GiST index — this is what makes
`ST_DWithin(driver_location, load_location, radius)` fast at scale instead of
scanning every row and computing Haversine distance in application code.

```sql
create extension if not exists postgis;
alter table "Driver" add column geog geography(Point, 4326)
  generated always as (ST_SetSRID(ST_MakePoint(last_lng, last_lat), 4326)::geography) stored;
create index driver_geog_idx on "Driver" using gist (geog);
```

## 3. Core logic recap (as specified)

- **No manual Busy/Empty toggle, anywhere.** Availability is *derived*:
  `lib/driverAvailability.ts` computes `FREE / ON_TRIP / OFFLINE` purely from
  GPS freshness + open trip state. There is no field in the schema for a
  manual status, and no button in the UI for one — this is intentional
  and should stay that way as the app grows.
- **Background GPS is the entire "online" mechanism.** See
  `driver-app/services/locationService.ts`. Starts the moment `HomeScreen`
  mounts, keeps running in the background via `expo-task-manager`, pings the
  server every 60s or 150m of movement (tunable).
- **Commission is versioned per trip**, not just a global constant — each
  `Trip` row snapshots `commissionPct` at match time (`PlatformConfig`
  controls the live default, adjustable 6–8% without a redeploy). This means
  changing the platform rate later never rewrites historical revenue numbers.

## 4. Project structure

```
freight-app/
├── prisma/
│   └── schema.prisma          # Full DB schema: Driver, LoadOwner, Load, Trip, PlatformConfig
├── admin-web/                 # Next.js admin dashboard
│   ├── app/dashboard/page.tsx # Live stats UI (polls every 15s)
│   ├── app/api/stats/route.ts # Aggregation endpoint
│   ├── components/StatCard.tsx
│   └── lib/
│       ├── db.ts                    # Prisma client singleton
│       └── driverAvailability.ts    # Derived online/free/on-trip logic
└── driver-app/                # Expo React Native driver app
    ├── screens/
    │   ├── RegistrationScreen.tsx   # All 5 required fields + validation
    │   └── HomeScreen.tsx           # Live map + auto nearby-load feed
    ├── services/
    │   ├── api.ts                   # Typed API client
    │   └── locationService.ts       # Background GPS — the core mechanic
    └── types/index.ts
```

## 5. Setup

```bash
# Backend / DB
npm install prisma @prisma/client
npx prisma migrate dev --name init
npx prisma generate

# Admin web
cd admin-web && npm install next react react-dom @prisma/client
npm run dev   # http://localhost:3000/dashboard

# Driver app
cd driver-app && npx create-expo-app . --template blank-typescript
npx expo install expo-location expo-task-manager react-native-maps
npx expo start
```

Add to `driver-app/app.json`:
```json
{
  "expo": {
    "ios": { "infoPlist": { "UIBackgroundModes": ["location"] } },
    "android": { "permissions": ["ACCESS_BACKGROUND_LOCATION", "ACCESS_FINE_LOCATION"] }
  }
}
```

## 6. What's intentionally stubbed for Phase 2

- Load Owner mobile/web app (schema exists, no UI yet)
- Trip lifecycle screens for the driver (accept → en route → delivered)
- Payments/payouts integration (Stripe Connect is a natural fit given
  per-trip commission splitting)
- Push notifications for new nearby loads (currently REST polling every 20s)
