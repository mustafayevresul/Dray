/**
 * Phase 5 — authentication core.
 *
 * Every protected route in this app follows the same shape:
 *   1. Pull the `Authorization: Bearer <token>` header
 *   2. Ask Supabase "whose token is this, really?" (never trust a client-
 *      supplied driverId/ownerId — that was the entire Phase 4 blocker)
 *   3. Resolve that verified identity to OUR Driver/LoadOwner row
 *   4. If the route also has a :driverId/:ownerId URL param, confirm it
 *      matches the resolved identity — a driver can only ever act as
 *      themselves, never as the id in someone else's URL
 *
 * This file is the ONLY place that talks to Supabase Auth's admin API.
 * Route handlers call requireDriver()/requireLoadOwner()/getAuthUser() and
 * catch AuthError — they never touch supabaseAdmin directly.
 */

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Service-role client: can verify ANY user's token server-side. This key
// must never reach a browser or mobile bundle — it lives only in
// admin-web's server environment (see admin-web/.env.example).
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export class AuthError extends Error {
  constructor(message: string, public status: 401 | 403) {
    super(message);
    this.name = "AuthError";
  }
}

/** Verifies the bearer token and returns the underlying Supabase auth user (id, phone). Throws AuthError(401) if missing/invalid/expired. */
export async function getAuthUser(req: NextRequest) {
  const header = req.headers.get("authorization");
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new AuthError("Missing bearer token", 401);

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new AuthError("Invalid or expired token", 401);
  return data.user; // { id, phone, email, ... } — id is auth.users.id
}

/**
 * Resolves a verified token to our Driver row. If `routeDriverId` is
 * passed (i.e. the route has a :driverId param), throws AuthError(403)
 * on any mismatch — this is what stops driver A from calling an endpoint
 * with driver B's id in the URL, even with a perfectly valid token.
 */
export async function requireDriver(req: NextRequest, routeDriverId?: string) {
  const authUser = await getAuthUser(req);
  const user = await db.user.findUnique({
    where: { authUserId: authUser.id },
    include: { driver: true },
  });
  if (!user?.driver) throw new AuthError("No driver profile for this account", 403);
  if (routeDriverId && user.driver.id !== routeDriverId) {
    throw new AuthError("This token does not belong to the driver in this URL", 403);
  }
  return user.driver;
}

/** Same as requireDriver, for the Load Owner side. */
export async function requireLoadOwner(req: NextRequest, routeOwnerId?: string) {
  const authUser = await getAuthUser(req);
  const user = await db.user.findUnique({
    where: { authUserId: authUser.id },
    include: { loadOwner: true },
  });
  if (!user?.loadOwner) throw new AuthError("No load owner profile for this account", 403);
  if (routeOwnerId && user.loadOwner.id !== routeOwnerId) {
    throw new AuthError("This token does not belong to the load owner in this URL", 403);
  }
  return user.loadOwner;
}

/**
 * For routes either role can call (e.g. trip chat), where the route
 * itself determines which side is allowed based on trip participants
 * rather than the URL. Returns whichever profile exists for this token.
 */
export async function requireDriverOrLoadOwner(req: NextRequest) {
  const authUser = await getAuthUser(req);
  const user = await db.user.findUnique({
    where: { authUserId: authUser.id },
    include: { driver: true, loadOwner: true },
  });
  if (!user?.driver && !user?.loadOwner) throw new AuthError("No profile for this account", 403);
  return user.driver
    ? { role: "DRIVER" as const, driver: user.driver }
    : { role: "LOAD_OWNER" as const, loadOwner: user.loadOwner! };
}

/**
 * STOPGAP, not real admin auth: there is no admin login/session system yet
 * (no AdminUser row is ever created by a registration flow — Phase 1's
 * AdminUser model exists in the schema but nothing populates or checks it).
 * Until that exists, /api/stats is gated by a single shared secret rather
 * than left completely open. Set ADMIN_API_KEY in admin-web's env and send
 * it as `x-admin-key` from wherever the dashboard is actually hosted/proxied.
 * Replace this with real per-admin Supabase Auth + an AdminUser check
 * before giving dashboard access to more than one or two trusted people.
 */
export function requireAdminApiKey(req: NextRequest) {
  const provided = req.headers.get("x-admin-key");
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || provided !== expected) {
    throw new AuthError("Invalid or missing admin key", 401);
  }
}

/** Standard error->response mapping for a route's catch block. */
export function authErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof AuthError) {
    return NextResponse.json({ message: err.message }, { status: err.status });
  }
  return null;
}
