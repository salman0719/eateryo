import { and, eq, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { platformAdmin, type PlatformAdminRole } from "@/lib/db/schema";

import { getSessionUser } from "./session";

/**
 * Platform operator identity (B0) — server-only, never imported from client
 * components. The admin panel reads `platform_admin` per request; the table
 * is never exposed to the browser (no Better Auth additional field).
 *
 * V1 enforces operator-only: a `viewer` row exists for the V2 read-only
 * support role, but nothing checks it yet, so it grants no access.
 * Revocation keeps the row with `revokedAt` set — grant history survives,
 * and the user's own café memberships are untouched.
 */

/** Driver-agnostic Drizzle base: Neon HTTP in the app, PGlite in tests. */
export type PlatformDb = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

/** The role of the user's active grant, or null (no row, or revoked). */
export async function getPlatformRole(
  db: PlatformDb,
  userId: string
): Promise<PlatformAdminRole | null> {
  const rows = await db
    .select({ role: platformAdmin.role })
    .from(platformAdmin)
    .where(and(eq(platformAdmin.userId, userId), isNull(platformAdmin.revokedAt)))
    .limit(1);
  return (rows[0]?.role as PlatformAdminRole | undefined) ?? null;
}

/** True when the user holds an active `operator` grant (the V1 gate). */
export async function isPlatformAdmin(db: PlatformDb, userId: string): Promise<boolean> {
  return (await getPlatformRole(db, userId)) === "operator";
}

function adminApiError(code: string, message: string, status: number): NextResponse {
  const response = NextResponse.json({ error: { code, message } }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/**
 * Server guard for admin API routes: the operator's user id, or a
 * ready-to-return response. Signed-out gets 401 (app convention);
 * signed-in non-operators and revoked operators get the plain 404 —
 * never a reason; an unreachable DB gets 503.
 */
export async function requirePlatformAdminApi(): Promise<string | NextResponse> {
  let account;
  try {
    account = await getSessionUser();
  } catch {
    return adminApiError(
      "server_db_unavailable",
      "Could not check operator access. Try again.",
      503
    );
  }
  if (!account) {
    return adminApiError("unauthorized", "Sign in to continue.", 401);
  }
  let allowed = false;
  try {
    allowed = await isPlatformAdmin(getDb(), account.id);
  } catch {
    return adminApiError(
      "server_db_unavailable",
      "Could not check operator access. Try again.",
      503
    );
  }
  if (!allowed) {
    return adminApiError("not_found", "Not found.", 404);
  }
  return account.id;
}

export interface GrantPlatformAdminInput {
  userId: string;
  /** Who granted it; null for the CLI bootstrap grant. */
  grantedBy?: string | null;
  role?: PlatformAdminRole;
}

export type GrantResult = { status: "granted" } | { status: "regranted" } | { status: "already" };

/**
 * Grant operator access. Idempotent: an active grant reports `already`,
 * a revoked one is restored (`regranted`) so the history stays in one row.
 */
export async function grantPlatformAdmin(
  db: PlatformDb,
  input: GrantPlatformAdminInput
): Promise<GrantResult> {
  const role = input.role ?? "operator";
  const existing = await db
    .select({ revokedAt: platformAdmin.revokedAt })
    .from(platformAdmin)
    .where(eq(platformAdmin.userId, input.userId))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(platformAdmin).values({
      userId: input.userId,
      role,
      grantedBy: input.grantedBy ?? null,
    });
    return { status: "granted" };
  }
  if (existing[0]!.revokedAt !== null) {
    await db
      .update(platformAdmin)
      .set({ revokedAt: null, role, grantedBy: input.grantedBy ?? null })
      .where(eq(platformAdmin.userId, input.userId));
    return { status: "regranted" };
  }
  return { status: "already" };
}

export type RevokeResult = { status: "revoked" } | { status: "not_found" };

/** Revoke operator access, keeping the row (and the user's cafés) intact. */
export async function revokePlatformAdmin(db: PlatformDb, userId: string): Promise<RevokeResult> {
  const existing = await db
    .select({ revokedAt: platformAdmin.revokedAt })
    .from(platformAdmin)
    .where(eq(platformAdmin.userId, userId))
    .limit(1);
  if (existing.length === 0 || existing[0]!.revokedAt !== null) {
    return { status: "not_found" };
  }
  await db
    .update(platformAdmin)
    .set({ revokedAt: new Date() })
    .where(eq(platformAdmin.userId, userId));
  return { status: "revoked" };
}
