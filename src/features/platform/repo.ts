import { and, eq, isNull, type SQLWrapper } from "drizzle-orm";

import type { PlatformDb } from "@/lib/auth/platform-admin";
import {
  accountSuspension,
  platformEvent,
  session,
  user,
  type SuspensionReason,
} from "@/lib/db/schema";

/**
 * Platform operations (B1) — server-only. Suspend and restore an account
 * with the audit event, atomically: a suspension without its audit row is
 * a bug, not a partial success, so the suspension row, the session deletes
 * and the event commit together, as do the restore update and its event.
 *
 * Suspension is account-scoped: it deletes the account's `session` rows
 * (an open tab stops working) and the sign-in gate refuses new ones, but
 * it never touches cafés, menus, publications or orders — diners keep
 * ordering while an owner is investigated.
 */

export type PlatformRepoErrorCode = "not_found" | "no_open_suspension" | "suspension_active";

export class PlatformRepoError extends Error {
  readonly code: PlatformRepoErrorCode;

  constructor(code: PlatformRepoErrorCode, message: string) {
    super(message);
    this.name = "PlatformRepoError";
    this.code = code;
  }
}

/**
 * The `insert`/`update`/`delete` surface shared by a Drizzle db and its
 * transaction — the only thing the atomic statements below are built on,
 * so the same builders run under `db.batch` and under `db.transaction`.
 *
 * Builders must return the query itself, never a promise: `db.batch`
 * inspects the builders (it calls `_prepare` on each), so an async helper
 * breaks the batch path while silently working under `db.transaction`.
 */
type WriteDb = Pick<PlatformDb, "insert" | "update" | "delete">;

type BatchCapableDb = PlatformDb & {
  batch: (items: unknown[]) => Promise<unknown[]>;
};

function hasBatch(db: PlatformDb): db is BatchCapableDb {
  return "batch" in db && typeof db.batch === "function";
}

/**
 * Commit several statements atomically on every driver this repo runs on.
 *
 * Verified against the pinned drivers (drizzle-orm 0.45): the Neon HTTP
 * driver has no interactive transactions (`db.transaction` throws) but its
 * `db.batch` runs the statements in a single non-interactive transaction
 * (the serverless driver's own README: "a single, non-interactive
 * transaction"); node-postgres and PGlite have no `db.batch` but support
 * `db.transaction`. Same statements, atomic both ways — the tests below
 * exercise the transaction path, production takes the batch path.
 */
async function runAtomically(
  db: PlatformDb,
  build: Array<(db: WriteDb) => SQLWrapper>
): Promise<void> {
  if (hasBatch(db)) {
    await db.batch(build.map((make) => make(db)));
    return;
  }
  await db.transaction(async (tx) => {
    for (const make of build) await make(tx);
  });
}

/** Postgres unique-violation code, surfaced by all three drivers. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

interface AccountSnapshot {
  id: string;
  email: string;
}

async function accountById(db: PlatformDb, userId: string): Promise<AccountSnapshot | null> {
  const rows = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export interface SuspendInput {
  targetUserId: string;
  reason: SuspensionReason;
  /** Optional operator note — stays internal, like the reason. */
  note?: string;
  /** Operator performing the suspension (the API guard guarantees one). */
  actorUserId: string;
}

export interface SuspensionSummary {
  id: string;
  reason: SuspensionReason;
  note: string | null;
  createdAt: Date;
}

export interface SuspendResult {
  suspension: SuspensionSummary;
  /** Sessions deleted, so already-open tabs stop working. */
  sessionsRevoked: number;
}

/**
 * Suspend an account: open row + session deletes + `account.suspended`
 * event, atomically. A second suspend while one is open is a conflict —
 * the pre-check answers it cleanly and the partial unique index is the
 * backstop for the race.
 */
export async function suspendAccount(db: PlatformDb, input: SuspendInput): Promise<SuspendResult> {
  const target = await accountById(db, input.targetUserId);
  if (!target) {
    throw new PlatformRepoError("not_found", "That account does not exist.");
  }
  const actor = await accountById(db, input.actorUserId);
  const open = await db
    .select({ id: accountSuspension.id })
    .from(accountSuspension)
    .where(
      and(eq(accountSuspension.userId, input.targetUserId), isNull(accountSuspension.liftedAt))
    )
    .limit(1);
  if (open[0]) {
    throw new PlatformRepoError("suspension_active", "That account is already suspended.");
  }

  const note = input.note ?? null;
  const build: Array<(db: WriteDb) => SQLWrapper> = [
    (w) =>
      w.insert(accountSuspension).values({
        userId: input.targetUserId,
        reason: input.reason,
        note,
        suspendedBy: input.actorUserId,
      }),
    (w) =>
      w.delete(session).where(eq(session.userId, input.targetUserId)).returning({ id: session.id }),
    (w) =>
      w.insert(platformEvent).values({
        action: "account.suspended",
        actorUserId: input.actorUserId,
        actorEmail: actor?.email ?? null,
        targetUserId: input.targetUserId,
        targetEmail: target.email,
        detail: note,
      }),
  ];

  // The session delete is the middle statement; its RETURNING rows are the
  // revoked count on every driver (insert/event appends resolve driver-
  // shaped results, so only index 1 is read).
  let sessionsRevoked = 0;
  try {
    const results: unknown[] = hasBatch(db)
      ? await db.batch(build.map((make) => make(db)))
      : await db.transaction(async (tx) => {
          const collected: unknown[] = [];
          for (const make of build) collected.push(await make(tx));
          return collected;
        });
    const deleted = results[1];
    sessionsRevoked = Array.isArray(deleted) ? deleted.length : 0;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PlatformRepoError("suspension_active", "That account is already suspended.");
    }
    throw error;
  }

  const created = await db
    .select({
      id: accountSuspension.id,
      reason: accountSuspension.reason,
      note: accountSuspension.note,
      createdAt: accountSuspension.createdAt,
    })
    .from(accountSuspension)
    .where(
      and(eq(accountSuspension.userId, input.targetUserId), isNull(accountSuspension.liftedAt))
    )
    .limit(1);
  const suspension = created[0];
  if (!suspension) {
    throw new PlatformRepoError("not_found", "That account does not exist.");
  }
  return {
    suspension: {
      id: suspension.id,
      reason: suspension.reason,
      note: suspension.note,
      createdAt: suspension.createdAt,
    },
    sessionsRevoked,
  };
}

export interface RestoreInput {
  targetUserId: string;
  /** Optional operator note, recorded on the `account.restored` event. */
  note?: string;
  /** Operator performing the restore (the API guard guarantees one). */
  actorUserId: string;
}

/**
 * Restore an account: set `liftedAt` on the open row + `account.restored`
 * event, atomically. The original suspension stays in history with its
 * reason, so a later operator can see why it happened. Sign-in works
 * immediately — the gate only looks for open rows.
 */
export async function restoreAccount(
  db: PlatformDb,
  input: RestoreInput
): Promise<{ suspensionId: string }> {
  const target = await accountById(db, input.targetUserId);
  if (!target) {
    throw new PlatformRepoError("not_found", "That account does not exist.");
  }
  const actor = await accountById(db, input.actorUserId);
  const open = await db
    .select({ id: accountSuspension.id })
    .from(accountSuspension)
    .where(
      and(eq(accountSuspension.userId, input.targetUserId), isNull(accountSuspension.liftedAt))
    )
    .limit(1);
  if (!open[0]) {
    throw new PlatformRepoError("no_open_suspension", "That account has no open suspension.");
  }

  const liftNote = input.note ?? null;
  await runAtomically(db, [
    (w) =>
      w
        .update(accountSuspension)
        .set({ liftedAt: new Date(), liftedBy: input.actorUserId, liftNote })
        .where(and(eq(accountSuspension.id, open[0]!.id), isNull(accountSuspension.liftedAt))),
    (w) =>
      w.insert(platformEvent).values({
        action: "account.restored",
        actorUserId: input.actorUserId,
        actorEmail: actor?.email ?? null,
        targetUserId: input.targetUserId,
        targetEmail: target.email,
        detail: liftNote,
      }),
  ]);
  return { suspensionId: open[0]!.id };
}
