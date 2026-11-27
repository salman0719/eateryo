import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { passwordResetToken } from "@/lib/db/schema";

import type { PlatformDb } from "./platform-admin";

/**
 * Self-serve password reset tokens (P5) — the recovery half of §10.
 *
 * The emailed link carries the raw token once; only its SHA-256 hash is
 * stored, like the invitation tokens. Single use: consuming a valid token
 * stamps `usedAt` in the same conditional UPDATE that proves it was still
 * live, so two concurrent uses cannot both succeed. Unknown, expired, and
 * spent tokens all read as invalid, so the route answers them with one
 * failure copy and no oracle.
 *
 * Server-only: it names the auth tables, so it must never reach a client
 * bundle. Hashing the *password* itself stays the auth library's default
 * (scrypt via `better-auth/crypto`); this module only hashes the token.
 */

/** Raw token bytes; base64url keeps the emailed link short and intact. */
export const RESET_TOKEN_BYTES = 32;
/** The link works once and dies after 30 minutes (§10). */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/** One-way digest of a presented token; the only form ever stored. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newResetToken(): string {
  return randomBytes(RESET_TOKEN_BYTES).toString("base64url");
}

export interface MintedResetToken {
  /** Raw token — handed to the email sender once, never stored. */
  token: string;
  expiresAt: Date;
}

/**
 * Mint a reset token for an account. Callers decide eligibility (an
 * account with a password for self-serve, any account for a forced
 * reset); this only stores the hash. Minting does not revoke older
 * tokens — the newest link working while an older one lingers is the
 * invitation behaviour too, and every token dies in 30 minutes anyway.
 */
export async function mintPasswordResetToken(
  db: PlatformDb,
  userId: string
): Promise<MintedResetToken> {
  const token = newResetToken();
  // The expiry is stamped by the database clock, not a JavaScript Date:
  // `expires_at` is a plain `timestamp` and a JS Date lands hours off on a
  // non-UTC machine, which would make every fresh token read as expired
  // (the `locked_until` lesson from P4).
  const rows = await db
    .insert(passwordResetToken)
    .values({
      userId,
      tokenHash: hashResetToken(token),
      expiresAt: sql`now() + (${RESET_TOKEN_TTL_MS / 1000} * interval '1 second')`,
    })
    .returning({ expiresAt: passwordResetToken.expiresAt });
  const expiresAt = rows[0]?.expiresAt ?? new Date(Date.now() + RESET_TOKEN_TTL_MS);
  return { token, expiresAt };
}

/**
 * Burn one valid token and return whose it was, or null when the token
 * is unknown, expired, or already spent. Expiry is read against the
 * database clock (`locked_until` taught us why) and the burn is one
 * conditional UPDATE, so checking and spending cannot separate.
 */
export async function consumePasswordResetToken(
  db: PlatformDb,
  token: string
): Promise<{ userId: string } | null> {
  if (!token) return null;
  const rows = await db
    .update(passwordResetToken)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(passwordResetToken.tokenHash, hashResetToken(token)),
        isNull(passwordResetToken.usedAt),
        sql`${passwordResetToken.expiresAt} > now()`
      )
    )
    .returning({ userId: passwordResetToken.userId });
  return rows[0] ?? null;
}

/**
 * Read a token without spending it, for the reset screen and for
 * validating the new password *before* the single use is burned: a typo
 * in the new password must not eat the link. Same single answer as the
 * burn — unknown, expired, or spent all read as null.
 */
export async function findValidResetToken(
  db: PlatformDb,
  token: string
): Promise<{ userId: string } | null> {
  if (!token) return null;
  const rows = await db
    .select({ userId: passwordResetToken.userId })
    .from(passwordResetToken)
    .where(
      and(
        eq(passwordResetToken.tokenHash, hashResetToken(token)),
        isNull(passwordResetToken.usedAt),
        sql`${passwordResetToken.expiresAt} > now()`
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
