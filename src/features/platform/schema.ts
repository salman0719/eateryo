/**
 * Admin read contracts (B2) — Zod at every server boundary.
 *
 * The list is one page query: search by name/email, filter by stage or
 * suspension, sort by newest / active / orders, keyset cursor. Detail and
 * event rows are id-scoped reads resolved through the operator guard's
 * scope — ids arrive in the path, never trusted from a body, and there is
 * no body on any B2 route. Least data throughout: no passwords or hashes,
 * no card data, no diner identities, no raw IP addresses, and the
 * suspension reason/note never leaves the server.
 */

import { z } from "zod";

import { PLATFORM_EVENT_ACTIONS } from "@/lib/db/schema";

import { ACCOUNT_STAGES } from "./stage";

/** One page holds 25 accounts; the query fetches one extra to detect next. */
export const ADMIN_ACCOUNTS_PAGE_SIZE = 25;

/** Operator log page size (same over-fetch rule as the accounts list). */
export const ADMIN_EVENTS_PAGE_SIZE = 25;

/** Which accounts the list holds. Orthogonal to suspension except `all`. */
export const adminAccountFilterSchema = z.enum([
  "all",
  "taking_orders",
  "not_onboarded",
  "suspended",
]);

export type AdminAccountFilter = z.infer<typeof adminAccountFilterSchema>;

/** `newest` by signup; `active` by last order; `orders` by 7-day volume. */
export const adminAccountSortSchema = z.enum(["newest", "active", "orders"]);

export type AdminAccountSort = z.infer<typeof adminAccountSortSchema>;

/**
 * Keyset cursor: the last row's sort key plus its id tiebreak. `key` is
 * an ISO timestamp for `newest`/`active` (active coalesces never-ordered
 * to the epoch, so the key is never null) and a zero-padded count for
 * `orders`. Opaque on the wire (base64url JSON); invalid cursors are a
 * 400, never a silent restart.
 */
export const adminCursorSchema = z.object({
  key: z.string().min(1).max(64),
  id: z.string().min(1).max(128),
});

export type AdminCursor = z.infer<typeof adminCursorSchema>;

export function encodeAdminCursor(cursor: AdminCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Null when the cursor is missing, malformed, or fails validation. */
export function decodeAdminCursor(raw: string | null | undefined): AdminCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const result = adminCursorSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const searchQuery = z.string().trim().min(1).max(120).optional();

/** GET /api/admin/accounts query: every field optional, defaults below. */
export const adminAccountsQuerySchema = z.object({
  q: searchQuery,
  filter: adminAccountFilterSchema.optional().default("all"),
  sort: adminAccountSortSchema.optional().default("newest"),
  cursor: z.string().min(1).max(512).optional(),
});

export type AdminAccountsQuery = z.infer<typeof adminAccountsQuerySchema>;

/** One row of the accounts list: counts plus the derived stage. */
export const adminAccountSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  createdAt: z.string(),
  cafeCount: z.number().int().nonnegative(),
  menuCount: z.number().int().nonnegative(),
  liveCount: z.number().int().nonnegative(),
  /** Orders in the trailing 7 days (drives the `orders` sort). */
  orders7: z.number().int().nonnegative(),
  /** Null when the account's cafés never took an order. */
  lastOrderAt: z.string().nullable(),
  suspended: z.boolean(),
  /** Set while an open suspension exists. */
  suspendedAt: z.string().nullable(),
  stage: z.enum(ACCOUNT_STAGES),
});

export type AdminAccountSummary = z.infer<typeof adminAccountSummarySchema>;

export const adminAccountsPageSchema = z.object({
  accounts: z.array(adminAccountSummarySchema),
  /** Absent on the last page. Pass back as `cursor` for the next page. */
  nextCursor: z.string().optional(),
});

export type AdminAccountsPage = z.infer<typeof adminAccountsPageSchema>;

/** One café membership on the detail page. */
export const adminDetailCafeSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  role: z.string(),
});

export type AdminDetailCafe = z.infer<typeof adminDetailCafeSchema>;

/** One menu on the detail page, with its live state — never its doc. */
export const adminDetailMenuSchema = z.object({
  id: z.string(),
  cafeId: z.string(),
  title: z.string(),
  /** True while a live pointer serves this menu to diners. */
  live: z.boolean(),
  slug: z.string().nullable(),
  updatedAt: z.string(),
});

export type AdminDetailMenu = z.infer<typeof adminDetailMenuSchema>;

/** Recent order on the detail page: status and total only, no lines. */
export const adminDetailOrderSchema = z.object({
  id: z.string(),
  cafeId: z.string(),
  tableLabel: z.string(),
  status: z.string(),
  totalCents: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
});

export type AdminDetailOrder = z.infer<typeof adminDetailOrderSchema>;

/**
 * One session on the detail page. The address and device label stay out:
 * support needs "where is this account signed in", not a raw IP, and the
 * agent string alone answers the device question.
 */
export const adminDetailSessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  userAgent: z.string().nullable(),
});

export type AdminDetailSession = z.infer<typeof adminDetailSessionSchema>;

/** One operator-log row about this account. */
export const adminDetailEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorEmail: z.string().nullable(),
  detail: z.string().nullable(),
  createdAt: z.string(),
});

export type AdminDetailEvent = z.infer<typeof adminDetailEventSchema>;

/** Derived timeline entry: account, café and audit milestones. */
export const adminTimelineEntrySchema = z.object({
  at: z.string(),
  kind: z.enum(["account_created", "cafe_joined", "suspended", "restored", "operator_event"]),
  label: z.string(),
});

export type AdminTimelineEntry = z.infer<typeof adminTimelineEntrySchema>;

/** GET /api/admin/accounts/[id]: everything support needs, nothing more. */
export const adminAccountDetailSchema = z.object({
  account: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    createdAt: z.string(),
  }),
  stage: z.enum(ACCOUNT_STAGES),
  suspension: z
    .object({
      reason: z.string(),
      suspendedAt: z.string(),
      suspendedBy: z.string().nullable(),
    })
    .nullable(),
  cafes: z.array(adminDetailCafeSchema),
  menus: z.array(adminDetailMenuSchema),
  usage: z.object({
    requests: z.number().int().nonnegative(),
    cap: z.number().int().positive(),
    remaining: z.number().int().nonnegative(),
  }),
  orders: z.object({
    total: z.number().int().nonnegative(),
    last7: z.number().int().nonnegative(),
    lastOrderAt: z.string().nullable(),
    recent: z.array(adminDetailOrderSchema),
  }),
  sessions: z.array(adminDetailSessionSchema),
  events: z.array(adminDetailEventSchema),
  timeline: z.array(adminTimelineEntrySchema),
});

export type AdminAccountDetail = z.infer<typeof adminAccountDetailSchema>;

/** GET /api/admin/events query: action family filter plus keyset cursor. */
export const adminEventsQuerySchema = z.object({
  action: z.enum(PLATFORM_EVENT_ACTIONS).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

export type AdminEventsQuery = z.infer<typeof adminEventsQuerySchema>;

export const adminEventRowSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorEmail: z.string().nullable(),
  targetEmail: z.string().nullable(),
  detail: z.string().nullable(),
  createdAt: z.string(),
});

export type AdminEventRow = z.infer<typeof adminEventRowSchema>;

export const adminEventsPageSchema = z.object({
  events: z.array(adminEventRowSchema),
  nextCursor: z.string().optional(),
});

export type AdminEventsPage = z.infer<typeof adminEventsPageSchema>;
