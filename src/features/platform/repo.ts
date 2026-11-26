import { and, desc, eq, isNull, lt, or, sql, type SQLWrapper } from "drizzle-orm";

import type { PlatformDb } from "@/lib/auth/platform-admin";
import {
  accountSuspension,
  menu,
  order,
  platformEvent,
  publishedMenu,
  restaurant,
  restaurantMembership,
  session,
  user,
  type PlatformEventAction,
  type SuspensionReason,
} from "@/lib/db/schema";
import { getMonthlyUsageSummary } from "@/features/usage/repo";

import {
  ADMIN_ACCOUNTS_PAGE_SIZE,
  ADMIN_EVENTS_PAGE_SIZE,
  encodeAdminCursor,
  type AdminAccountDetail,
  type AdminAccountFilter,
  type AdminAccountSort,
  type AdminAccountSummary,
  type AdminCursor,
  type AdminEventsPage,
  type AdminTimelineEntry,
} from "./schema";
import { deriveAccountStage, type AccountStage } from "./stage";

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

export type PlatformRepoErrorCode =
  "not_found" | "no_open_suspension" | "suspension_active" | "invalid_cursor";

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

/* ------------------------------------------------------------------ */
/* B2 reads: one page query, no N+1                                  */
/* ------------------------------------------------------------------ */

/**
 * Membership-scoped aggregates for the accounts list (B2).
 *
 * Every count is a correlated scalar subquery on the row's own user id,
 * so the whole page is one round trip — never one query per account.
 * The filter names read as stages: `taking_orders` reached ordering
 * (a first order exists, the plan's definition of onboarded),
 * `not_onboarded` never ordered, `suspended` holds an open suspension.
 */

/**
 * Correlated scalars, written with table-qualified names: drizzle renders
 * an interpolated column as a bare identifier, which turns ambiguous (or
 * silently correlates to the wrong table) the moment the fragment joins.
 * Spelling the tables out keeps each subquery pinned to the outer row.
 */

const cafeCountSql = sql<number>`(select count(*)::int from "restaurant_membership" where "restaurant_membership"."user_id" = "user"."id")`;

const menuCountSql = sql<number>`(select count(*)::int from "menu" join "restaurant_membership" on "restaurant_membership"."restaurant_id" = "menu"."restaurant_id" where "restaurant_membership"."user_id" = "user"."id")`;

const liveCountSql = sql<number>`(select count(*)::int from "published_menu" join "restaurant_membership" on "restaurant_membership"."restaurant_id" = "published_menu"."restaurant_id" where "restaurant_membership"."user_id" = "user"."id" and "published_menu"."published_at" is not null)`;

const orderCountSql = sql<number>`(select count(*)::int from "order" join "restaurant_membership" on "restaurant_membership"."restaurant_id" = "order"."restaurant_id" where "restaurant_membership"."user_id" = "user"."id")`;

const orders7Sql = sql<number>`(select count(*)::int from "order" join "restaurant_membership" on "restaurant_membership"."restaurant_id" = "order"."restaurant_id" where "restaurant_membership"."user_id" = "user"."id" and "order"."created_at" > now() - interval '7 days')`;

const lastOrderAtSql = sql<Date | null>`(select max("order"."created_at") from "order" join "restaurant_membership" on "restaurant_membership"."restaurant_id" = "order"."restaurant_id" where "restaurant_membership"."user_id" = "user"."id")`;

const suspendedAtSql = sql<Date | null>`(select "account_suspension"."created_at" from "account_suspension" where "account_suspension"."user_id" = "user"."id" and "account_suspension"."lifted_at" is null limit 1)`;

/** Never-ordered accounts sort as the epoch, so the key is never null. */
const activeKeySql = sql<Date>`coalesce((${lastOrderAtSql}), '1970-01-01 00:00:00+00'::timestamptz)`;

export interface ListAccountsInput {
  q?: string;
  filter?: AdminAccountFilter;
  sort?: AdminAccountSort;
  cursor?: AdminCursor | null;
}

export interface ListAccountsResult {
  accounts: AdminAccountSummary[];
  nextCursor?: string;
}

/** Escape the LIKE wildcards so a search for `%` finds a `%`. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function cursorDate(key: string): Date {
  const date = new Date(key);
  if (Number.isNaN(date.getTime())) {
    throw new PlatformRepoError("invalid_cursor", "That page cursor is not valid.");
  }
  return date;
}

/**
 * Raw `sql` fragments carry no type parsers: an aggregate over one can
 * arrive as a string on drivers that hand Dates to typed columns, so both
 * shapes normalize here instead of at each call site.
 */
function toDate(value: Date | string | null): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

/** Split an `orders` cursor key (`<count>:<iso>`) back into its parts. */
function ordersCursorKey(key: string): { count: number; at: Date } {
  const cut = key.indexOf(":");
  const count = cut < 0 ? NaN : Number(key.slice(0, cut));
  const at = cut < 0 ? new Date(NaN) : new Date(key.slice(cut + 1));
  if (!Number.isInteger(count) || count < 0 || Number.isNaN(at.getTime())) {
    throw new PlatformRepoError("invalid_cursor", "That page cursor is not valid.");
  }
  return { count, at };
}

/**
 * One 25-row page of accounts with aggregates, keyset-paginated. The
 * keyset columns always match the sort order, so pages hold no
 * duplicates and no gaps even while accounts sign up mid-scroll.
 */
export async function listAccounts(
  db: PlatformDb,
  input: ListAccountsInput = {}
): Promise<ListAccountsResult> {
  const filter = input.filter ?? "all";
  const sort = input.sort ?? "newest";
  const cursor = input.cursor ?? null;

  const conditions: SQLWrapper[] = [];
  const trimmed = input.q?.trim();
  if (trimmed) {
    const pattern = likePattern(trimmed);
    conditions.push(
      sql`(${user.email} ilike ${pattern} escape '\\' or ${user.name} ilike ${pattern} escape '\\')`
    );
  }
  if (filter === "suspended") {
    conditions.push(
      sql`exists(select 1 from "account_suspension" where "account_suspension"."user_id" = "user"."id" and "account_suspension"."lifted_at" is null)`
    );
  } else if (filter === "taking_orders") {
    conditions.push(sql`(${orderCountSql} > 0)`);
  } else if (filter === "not_onboarded") {
    conditions.push(sql`(${orderCountSql} = 0)`);
  }

  if (sort === "newest" && cursor) {
    const at = cursorDate(cursor.key);
    conditions.push(
      or(lt(user.createdAt, at), and(eq(user.createdAt, at), lt(user.id, cursor.id)))!
    );
  } else if (sort === "active" && cursor) {
    const at = cursorDate(cursor.key);
    conditions.push(or(lt(activeKeySql, at), and(eq(activeKeySql, at), lt(user.id, cursor.id)))!);
  } else if (sort === "orders" && cursor) {
    const { count, at } = ordersCursorKey(cursor.key);
    conditions.push(
      or(
        lt(orders7Sql, count),
        and(eq(orders7Sql, count), lt(user.createdAt, at)),
        and(eq(orders7Sql, count), eq(user.createdAt, at), lt(user.id, cursor.id))
      )!
    );
  }

  const orderBy =
    sort === "active"
      ? [desc(activeKeySql), desc(user.id)]
      : sort === "orders"
        ? [desc(orders7Sql), desc(user.createdAt), desc(user.id)]
        : [desc(user.createdAt), desc(user.id)];

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      cafeCount: cafeCountSql,
      menuCount: menuCountSql,
      liveCount: liveCountSql,
      orders7: orders7Sql,
      orderCount: orderCountSql,
      lastOrderAt: lastOrderAtSql,
      suspendedAt: suspendedAtSql,
    })
    .from(user)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderBy)
    .limit(ADMIN_ACCOUNTS_PAGE_SIZE + 1);

  const page = rows.slice(0, ADMIN_ACCOUNTS_PAGE_SIZE);
  const accounts: AdminAccountSummary[] = page.map((row) => {
    const stage: AccountStage = deriveAccountStage({
      cafeCount: row.cafeCount,
      menuCount: row.menuCount,
      liveCount: row.liveCount,
      orderCount: row.orderCount,
    });
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      createdAt: row.createdAt.toISOString(),
      cafeCount: row.cafeCount,
      menuCount: row.menuCount,
      liveCount: row.liveCount,
      orders7: row.orders7,
      lastOrderAt: toDate(row.lastOrderAt)?.toISOString() ?? null,
      suspended: toDate(row.suspendedAt) !== null,
      suspendedAt: toDate(row.suspendedAt)?.toISOString() ?? null,
      stage,
    };
  });

  if (rows.length <= ADMIN_ACCOUNTS_PAGE_SIZE) return { accounts };
  const last = page[page.length - 1]!;
  const key =
    sort === "active"
      ? (toDate(last.lastOrderAt)?.toISOString() ?? new Date(0).toISOString())
      : sort === "orders"
        ? `${last.orders7}:${last.createdAt.toISOString()}`
        : last.createdAt.toISOString();
  return { accounts, nextCursor: encodeAdminCursor({ key, id: last.id }) };
}

/* ------------------------------------------------------------------ */
/* B2 reads: account detail + operator log                            */
/* ------------------------------------------------------------------ */

/** Recent orders and sessions shown on the detail page (support-sized). */
const DETAIL_RECENT_ORDERS = 10;
const DETAIL_SESSIONS = 20;
const DETAIL_EVENTS = 20;

/**
 * One account, everything support needs to answer for it (B2).
 *
 * Every read is scoped by the account's own id — menus and orders join
 * through its memberships, so nothing from another tenant can appear —
 * and the shape carries no document bodies, no line items, no session
 * addresses and no password material. Seven constant queries, no
 * per-row follow-ups. Throws `not_found` for an unknown id.
 */
export async function getAccountDetail(
  db: PlatformDb,
  targetUserId: string
): Promise<AdminAccountDetail> {
  const header = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      cafeCount: cafeCountSql,
      menuCount: menuCountSql,
      liveCount: liveCountSql,
      orderCount: orderCountSql,
      orders7: orders7Sql,
      lastOrderAt: lastOrderAtSql,
    })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1);
  const row = header[0];
  if (!row) {
    throw new PlatformRepoError("not_found", "That account does not exist.");
  }

  const [suspensions, memberships, menus, recentOrders, sessions, events, usage] =
    await Promise.all([
      db
        .select({
          reason: accountSuspension.reason,
          suspendedBy: accountSuspension.suspendedBy,
          createdAt: accountSuspension.createdAt,
          liftedAt: accountSuspension.liftedAt,
        })
        .from(accountSuspension)
        .where(eq(accountSuspension.userId, targetUserId))
        .orderBy(desc(accountSuspension.createdAt)),
      db
        .select({
          restaurantId: restaurantMembership.restaurantId,
          role: restaurantMembership.role,
          createdAt: restaurantMembership.createdAt,
          name: restaurant.name,
          slug: restaurant.slug,
        })
        .from(restaurantMembership)
        .innerJoin(restaurant, eq(restaurant.id, restaurantMembership.restaurantId))
        .where(eq(restaurantMembership.userId, targetUserId))
        .orderBy(restaurantMembership.createdAt),
      db
        .select({
          id: menu.id,
          restaurantId: menu.restaurantId,
          title: menu.title,
          updatedAt: menu.updatedAt,
          slug: publishedMenu.slug,
          publishedAt: publishedMenu.publishedAt,
        })
        .from(menu)
        .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, menu.restaurantId))
        .leftJoin(publishedMenu, eq(publishedMenu.menuId, menu.id))
        .where(eq(restaurantMembership.userId, targetUserId))
        .orderBy(desc(menu.updatedAt)),
      db
        .select({
          id: order.id,
          restaurantId: order.restaurantId,
          tableLabel: order.tableLabel,
          status: order.status,
          totalCents: order.totalCents,
          createdAt: order.createdAt,
        })
        .from(order)
        .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, order.restaurantId))
        .where(eq(restaurantMembership.userId, targetUserId))
        .orderBy(desc(order.createdAt))
        .limit(DETAIL_RECENT_ORDERS),
      db
        .select({
          id: session.id,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          // No address column: support sees the device, never a raw IP.
          userAgent: session.userAgent,
        })
        .from(session)
        .where(eq(session.userId, targetUserId))
        .orderBy(desc(session.createdAt))
        .limit(DETAIL_SESSIONS),
      db
        .select({
          id: platformEvent.id,
          action: platformEvent.action,
          actorEmail: platformEvent.actorEmail,
          detail: platformEvent.detail,
          createdAt: platformEvent.createdAt,
        })
        .from(platformEvent)
        .where(eq(platformEvent.targetUserId, targetUserId))
        .orderBy(desc(platformEvent.createdAt))
        .limit(DETAIL_EVENTS),
      getMonthlyUsageSummary(db, targetUserId),
    ]);

  const open = suspensions.find((entry) => entry.liftedAt === null) ?? null;
  const stage = deriveAccountStage({
    cafeCount: row.cafeCount,
    menuCount: row.menuCount,
    liveCount: row.liveCount,
    orderCount: row.orderCount,
  });

  // Each builder is annotated on its own: kinds stay literals where they
  // are written instead of widening through the spreads downstream.
  const createdEntry: AdminTimelineEntry = {
    at: row.createdAt.toISOString(),
    kind: "account_created",
    label: "Account created",
  };
  const joinedEntries: AdminTimelineEntry[] = memberships.map((m) => ({
    at: m.createdAt.toISOString(),
    kind: "cafe_joined" as const,
    label: `Joined ${m.name} as ${m.role}`,
  }));
  const suspensionEntries: AdminTimelineEntry[] = suspensions.flatMap((entry) => [
    {
      at: entry.createdAt.toISOString(),
      kind: "suspended" as const,
      label: `Suspended — ${entry.reason}`,
    },
    ...(entry.liftedAt
      ? [
          {
            at: entry.liftedAt.toISOString(),
            kind: "restored" as const,
            label: "Suspension lifted",
          } satisfies AdminTimelineEntry,
        ]
      : []),
  ]);
  // Suspension history already covers its two actions; the rest (grants,
  // revocations, and whatever B4/B5 add) reads straight from the log.
  const operatorEntries: AdminTimelineEntry[] = events
    .filter((event) => event.action !== "account.suspended" && event.action !== "account.restored")
    .map((event) => ({
      at: event.createdAt.toISOString(),
      kind: "operator_event" as const,
      label: `${event.action} by ${event.actorEmail ?? "the CLI"}`,
    }));
  const timeline: AdminTimelineEntry[] = [
    createdEntry,
    ...joinedEntries,
    ...suspensionEntries,
    ...operatorEntries,
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    account: {
      id: row.id,
      name: row.name,
      email: row.email,
      createdAt: row.createdAt.toISOString(),
    },
    stage,
    suspension: open
      ? {
          reason: open.reason,
          suspendedAt: open.createdAt.toISOString(),
          suspendedBy: open.suspendedBy,
        }
      : null,
    cafes: memberships.map((m) => ({
      id: m.restaurantId,
      name: m.name,
      slug: m.slug,
      role: m.role,
    })),
    menus: menus.map((m) => ({
      id: m.id,
      cafeId: m.restaurantId,
      title: m.title,
      live: m.publishedAt !== null,
      slug: m.slug,
      updatedAt: m.updatedAt.toISOString(),
    })),
    usage: { requests: usage.requests, cap: usage.cap, remaining: usage.remaining },
    orders: {
      total: row.orderCount,
      last7: row.orders7,
      lastOrderAt: toDate(row.lastOrderAt)?.toISOString() ?? null,
      recent: recentOrders.map((o) => ({
        id: o.id,
        cafeId: o.restaurantId,
        tableLabel: o.tableLabel,
        status: o.status,
        totalCents: o.totalCents,
        createdAt: o.createdAt.toISOString(),
      })),
    },
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      userAgent: s.userAgent,
    })),
    events: events.map((event) => ({
      id: event.id,
      action: event.action,
      actorEmail: event.actorEmail,
      detail: event.detail,
      createdAt: event.createdAt.toISOString(),
    })),
    timeline,
  };
}

export interface ListPlatformEventsInput {
  action?: PlatformEventAction;
  cursor?: AdminCursor | null;
}

/**
 * The operator log, newest first, keyset-paginated (B2). The action
 * filter takes one of the recorded base-four actions; passwords and
 * second-factor families join it with B4/B5, which only widen the enum.
 */
export async function listPlatformEvents(
  db: PlatformDb,
  input: ListPlatformEventsInput = {}
): Promise<AdminEventsPage> {
  const conditions: SQLWrapper[] = [];
  if (input.action) {
    conditions.push(eq(platformEvent.action, input.action));
  }
  if (input.cursor) {
    const at = cursorDate(input.cursor.key);
    conditions.push(
      or(
        lt(platformEvent.createdAt, at),
        and(eq(platformEvent.createdAt, at), lt(platformEvent.id, input.cursor.id))
      )!
    );
  }
  const rows = await db
    .select({
      id: platformEvent.id,
      action: platformEvent.action,
      actorEmail: platformEvent.actorEmail,
      targetEmail: platformEvent.targetEmail,
      detail: platformEvent.detail,
      createdAt: platformEvent.createdAt,
    })
    .from(platformEvent)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(platformEvent.createdAt), desc(platformEvent.id))
    .limit(ADMIN_EVENTS_PAGE_SIZE + 1);

  const page = rows.slice(0, ADMIN_EVENTS_PAGE_SIZE);
  const events = page.map((event) => ({
    ...event,
    createdAt: event.createdAt.toISOString(),
  }));
  if (rows.length <= ADMIN_EVENTS_PAGE_SIZE) return { events };
  const last = page[page.length - 1]!;
  return {
    events,
    nextCursor: encodeAdminCursor({ key: last.createdAt.toISOString(), id: last.id }),
  };
}
