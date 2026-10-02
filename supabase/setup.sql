-- ============================================================
-- Dray — Supabase one-time setup
-- Run this in the Supabase SQL Editor AFTER `prisma migrate deploy`
-- has created all the tables. Safe to re-run (every statement is
-- idempotent) if you're not sure whether a step already ran.
-- ============================================================

-- 1. PostGIS — needed for real geo-radius driver/load matching.
--    lib/matching.ts currently does a plain Haversine scan in application
--    code (fine at low driver counts); switching to ST_DWithin against a
--    geography column is a straight performance upgrade, not a behavior
--    change, whenever you're ready for it.
create extension if not exists postgis;

alter table "Driver" add column if not exists geog geography(Point, 4326)
  generated always as (
    case
      when last_lat is not null and last_lng is not null
        then ST_SetSRID(ST_MakePoint(last_lng, last_lat), 4326)::geography
      else null
    end
  ) stored;

create index if not exists driver_geog_idx on "Driver" using gist (geog);

alter table "Load" add column if not exists geog geography(Point, 4326)
  generated always as (ST_SetSRID(ST_MakePoint("pickupLng", "pickupLat"), 4326)::geography) stored;

create index if not exists load_geog_idx on "Load" using gist (geog);

-- 2. Realtime — required for Phase 3's chat (driver-app/services/chat.ts,
--    load-owner-web/lib/chat.ts both subscribe to this table directly).
--    Without this, messages still save via the REST API, they just won't
--    appear live — the chat screen would need a manual refresh.
alter publication supabase_realtime add table "ChatMessage";

-- 3. Storage — bucket for Proof of Delivery photos.
--    driver-app/screens/ProofOfDeliveryScreen.tsx's uploadPhotoToStorage()
--    stub targets this bucket name; update both together if you rename it.
insert into storage.buckets (id, name, public)
values ('proof-of-delivery', 'proof-of-delivery', true)
on conflict (id) do nothing;

-- Drivers can upload; anyone with the (effectively unguessable) file path
-- can view — matches how POD photo URLs are just handed to the load owner
-- directly rather than gated behind a signed-URL flow. Tighten this if
-- POD photos need to stay private to the two trip participants specifically.
create policy if not exists "Anyone can view POD photos"
  on storage.objects for select
  using (bucket_id = 'proof-of-delivery');

create policy if not exists "Authenticated uploads to POD bucket"
  on storage.objects for insert
  with check (bucket_id = 'proof-of-delivery');

-- ============================================================
-- NOTE ON ROW LEVEL SECURITY: this schema is accessed exclusively through
-- Prisma from admin-web's server-side API routes, using the DATABASE_URL
-- connection (not the Supabase client library, and not a user's Supabase
-- Auth session). RLS policies on these tables would therefore do nothing
-- useful today — Prisma's Postgres connection bypasses them entirely, and
-- all authorization currently happens in application code inside each API
-- route (e.g. "does this driverId match trip.driverId"). If you later move
-- to Supabase Auth + client-side Supabase queries for anything beyond
-- chat's Realtime subscription, revisit this and add real RLS policies
-- for whatever queries stop going through Prisma. See README_PHASE4.md's
-- go-live blockers list — this is the same underlying gap as "no real
-- authentication yet".
-- ============================================================
