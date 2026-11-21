import { createHash, randomBytes } from "node:crypto";

import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";

import {
  menu as menuTable,
  order as orderTable,
  orderLine as orderLineTable,
  orderLineOption as orderLineOptionTable,
  orderRateLimit,
  orderTracking as orderTrackingTable,
  restaurant as restaurantTable,
  restaurantMembership,
} from "@/lib/db/schema";
import {
  normalizeSelections,
  priceWithOptions,
  validateOptionSelections,
} from "@/features/menu/option-groups";
import { menuAvailabilitySchema } from "@/features/availability/schema";
import { isMenuOpenAt } from "@/features/availability/open-at";
import type { TenancyDb } from "@/features/tenancy/repo";
import { getPublishedMenuByPath, type PublishedMenuPage } from "@/features/publishing/repo";
import { getRestaurantBySlug } from "@/features/tables/repo";
import { menuDocumentSchema, type MenuDocument, type MenuItem } from "@/features/menu/schema";

import { getPaymentAccount } from "@/features/payments/accounts";
import { resolveCheckout } from "@/features/payments/resolver";
import {
  canTransitionOrderStatus,
  orderSchema,
  orderStatusSchema,
  type Order,
  type OrderStatus,
} from "./schema";
import { normalizeTableLabel } from "./table-links";

/**
 * Server repository for table orders (Step 10).
 *
 * The public path never trusts the client: a diner sends item ids, variants,
 * and quantities only. Names and prices are copied from the published
 * snapshot the diner actually saw, quantities are capped, and the total is
 * computed here in integer cents — `null` as soon as any line is unpriced
 * (Phase 1 honesty, never a partial sum).
 *
 * The staff path is tenancy-scoped: orders are readable and changeable only
 * by members of the restaurant that owns them, and another tenant's order is
 * reported as `not_found` so ids cannot be probed. Status changes are
 * conditional on the `updatedAt` the caller saw; a concurrent change returns
 * `stale` with the current order instead of silently overwriting it.
 */

export type OrderRepoErrorCode =
  | "not_found"
  | "forbidden"
  | "invalid"
  | "stale"
  | "menu_not_live"
  | "unknown_item"
  | "item_unavailable"
  | "rate_limited";

export class OrderRepoError extends Error {
  readonly code: OrderRepoErrorCode;
  /** For `stale`: the order as it stands on the server now. */
  readonly current: Order | null;

  constructor(code: OrderRepoErrorCode, message: string, current: Order | null = null) {
    super(message);
    this.name = "OrderRepoError";
    this.code = code;
    this.current = current;
  }
}

/** Payload caps — small enough to be cheap, generous for a real table. */
export const MAX_ORDER_LINES = 30;
export const MAX_LINE_QUANTITY = 20;
export const MAX_ORDER_NOTE_LENGTH = 280;
/** Orders allowed per caller per fixed one-minute window. */
export const ORDER_RATE_LIMIT_PER_WINDOW = 12;

export interface OrderLineRequest {
  menuItemId: string;
  variantName?: string | null;
  /** Picked add-ons (group + choice names only — deltas resolve server-side). */
  options?: ReadonlyArray<{ groupName: string; choiceName: string }>;
  quantity: number;
}
/** Generous per-line pick cap: a payload guard, not a menu rule. */
export const MAX_LINE_OPTIONS = 20;

export interface PlaceOrderInput {
  /** Public menu slug the diner ordered from. */
  slug: string;
  /** The café's public slug — the menu is resolved inside it. */
  restaurantSlug: string;
  tableLabel: string;
  note?: string | null;
  lines: OrderLineRequest[];
  /**
   * Test clock for the open-hours check and the row stamps. Production
   * never sets this (the route builds the input without it), so callers
   * cannot invent the time — tests pin it instead of depending on today.
   */
  now?: Date;
}

export interface TableOrderLineRequest extends OrderLineRequest {
  /** Public slug of the menu this line comes from. */
  menuSlug: string;
}

export interface PlaceTableOrderInput {
  /** Public restaurant slug from the table QR (`/r/<slug>/t/<table>`). */
  restaurantSlug: string;
  tableLabel: string;
  note?: string | null;
  lines: TableOrderLineRequest[];
  /**
   * Test clock for the open-hours check and the row stamps. Production
   * never sets this (the route builds the input without it), so callers
   * cannot invent the time — tests pin it instead of depending on today.
   */
  now?: Date;
}

export interface StaffOrderQuery {
  /** Return only orders changed after this ISO timestamp (incremental poll). */
  since?: string | null;
  /** Restrict to one restaurant (must be one the caller belongs to). */
  restaurantId?: string | null;
  limit?: number;
  /**
   * Board window: only orders created at/after this ISO timestamp. Pushed
   * into SQL so a 24h board never serializes history it hides.
   */
  from?: string | null;
  /** Board window end: only orders created at/before this ISO timestamp. */
  to?: string | null;
  /**
   * Keyset cursor for history pages: `<createdAt>|<id>` of the previous
   * page's last order (from `nextCursor`). Newest-first, id breaks ties.
   */
  cursor?: string | null;
}

/** Opaque page cursor: the previous page's last row, newest-first. */
function parseBoardCursor(cursor: string): { createdAt: Date; id: string } {
  const separator = cursor.lastIndexOf("|");
  const createdAt = separator < 0 ? null : new Date(cursor.slice(0, separator));
  const id = separator < 0 ? "" : cursor.slice(separator + 1);
  if (!createdAt || Number.isNaN(createdAt.getTime()) || !id) {
    throw new OrderRepoError("invalid", "cursor must be a nextCursor from this board.");
  }
  return { createdAt, id };
}

function boardCursorFor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

type OrderRow = typeof orderTable.$inferSelect;
type OrderLineRow = typeof orderLineTable.$inferSelect;
type OrderLineOptionRow = typeof orderLineOptionTable.$inferSelect;

function iso(value: Date): string {
  return value.toISOString();
}

/** Rows → the canonical `Order` wire shape (dollars, ISO timestamps). */
function toOrder(
  row: OrderRow,
  lines: OrderLineRow[],
  optionsByLine: Map<string, OrderLineOptionRow[]> = new Map()
): Order {
  const parsed = orderSchema.safeParse({
    id: row.id,
    menuId: row.menuId,
    menuTitle: row.menuTitle,
    tableLabel: row.tableLabel,
    currency: row.currency,
    note: row.note,
    lines: lines.map((line) => ({
      menuItemId: line.menuItemId,
      name: line.name,
      variantName: line.variantName,
      options: (optionsByLine.get(line.id) ?? []).map((option) => ({
        groupName: option.groupName,
        choiceName: option.choiceName,
        priceDelta: option.priceDeltaCents === null ? null : option.priceDeltaCents / 100,
      })),
      unitPrice: line.unitPriceCents === null ? null : line.unitPriceCents / 100,
      quantity: line.quantity,
      menuId: line.menuId,
      menuTitle: line.menuTitle,
    })),
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    paymentStatus: row.paymentStatus,
    paymentProvider: row.paymentProvider,
  });
  if (!parsed.success) {
    // A stored row that no longer matches the canonical schema is a server
    // bug; failing loudly beats rendering a half-order on the board.
    throw new Error(`stored order ${row.id} failed canonical schema validation`);
  }
  return parsed.data;
}

/** Load the lines for a set of orders, grouped by order id. */
async function linesByOrderId(
  db: TenancyDb,
  orderIds: string[]
): Promise<Map<string, OrderLineRow[]>> {
  const grouped = new Map<string, OrderLineRow[]>();
  if (orderIds.length === 0) return grouped;
  const rows = await db
    .select()
    .from(orderLineTable)
    .where(inArray(orderLineTable.orderId, orderIds))
    .orderBy(asc(orderLineTable.orderId));
  for (const row of rows) {
    const list = grouped.get(row.orderId) ?? [];
    list.push(row);
    grouped.set(row.orderId, list);
  }
  return grouped;
}

/** Load picked add-ons for a set of lines, grouped by line id. */
async function optionsByLineId(
  db: TenancyDb,
  lineIds: string[]
): Promise<Map<string, OrderLineOptionRow[]>> {
  const grouped = new Map<string, OrderLineOptionRow[]>();
  if (lineIds.length === 0) return grouped;
  const rows = await db
    .select()
    .from(orderLineOptionTable)
    .where(inArray(orderLineOptionTable.orderLineId, lineIds));
  for (const row of rows) {
    const list = grouped.get(row.orderLineId) ?? [];
    list.push(row);
    grouped.set(row.orderLineId, list);
  }
  return grouped;
}

/** Lines plus their picks for a set of orders (one extra query, no N+1). */
async function linesWithOptions(
  db: TenancyDb,
  orderIds: string[]
): Promise<{ lines: Map<string, OrderLineRow[]>; options: Map<string, OrderLineOptionRow[]> }> {
  const lines = await linesByOrderId(db, orderIds);
  const lineIds = [...lines.values()].flat().map((line) => line.id);
  return { lines, options: await optionsByLineId(db, lineIds) };
}

function collectItems(doc: MenuDocument): Map<string, MenuItem> {
  const items = new Map<string, MenuItem>();
  for (const category of doc.categories) {
    for (const item of category.items) items.set(item.id, item);
  }
  return items;
}

/** Shared envelope checks: table label, note length, line-count caps. */
function validateOrderEnvelope(
  tableLabel: string,
  note: string | null | undefined,
  lineCount: number
): { tableLabel: string; note: string | null } {
  const label = normalizeTableLabel(tableLabel);
  if (!label) {
    throw new OrderRepoError("invalid", "A table label is required.");
  }
  const trimmed = note?.trim() ? note.trim() : null;
  if (trimmed && trimmed.length > MAX_ORDER_NOTE_LENGTH) {
    throw new OrderRepoError(
      "invalid",
      `Keep the note to ${MAX_ORDER_NOTE_LENGTH} characters or fewer.`
    );
  }
  if (lineCount === 0) {
    throw new OrderRepoError("invalid", "An order needs at least one line.");
  }
  if (lineCount > MAX_ORDER_LINES) {
    throw new OrderRepoError("invalid", `An order can have at most ${MAX_ORDER_LINES} lines.`);
  }
  return { tableLabel: label, note: trimmed };
}

interface ResolvedLine {
  menuItemId: string;
  name: string;
  variantName: string | null;
  options: { groupName: string; choiceName: string; priceDeltaCents: number | null }[];
  unitPriceCents: number | null;
  quantity: number;
}

/** Resolve one client line against a published snapshot (never trust names/prices). */
function resolveOrderLine(items: Map<string, MenuItem>, request: OrderLineRequest): ResolvedLine {
  if (!Number.isInteger(request.quantity) || request.quantity < 1) {
    throw new OrderRepoError("invalid", "Every line needs a whole quantity of at least 1.");
  }
  if (request.quantity > MAX_LINE_QUANTITY) {
    throw new OrderRepoError("invalid", `A single line is limited to ${MAX_LINE_QUANTITY} items.`);
  }
  const item = items.get(request.menuItemId);
  if (!item) {
    throw new OrderRepoError("unknown_item", "That item is not on the published menu.");
  }
  if (item.available === false) {
    throw new OrderRepoError("item_unavailable", `“${item.name}” is sold out.`);
  }

  const variantName = request.variantName?.trim() || null;
  if (item.variants.length > 0) {
    if (!variantName || !item.variants.some((variant) => variant.name === variantName)) {
      throw new OrderRepoError("invalid", `Choose a size for “${item.name}”.`);
    }
  } else if (variantName !== null) {
    throw new OrderRepoError("invalid", `“${item.name}” has no sizes to choose from.`);
  }
  const variant = variantName
    ? (item.variants.find((candidate) => candidate.name === variantName) ?? null)
    : null;
  const price = variant ? variant.price : item.price;

  const picks = normalizeSelections(request.options ?? []);
  if (picks.length > MAX_LINE_OPTIONS) {
    throw new OrderRepoError("invalid", `A single line takes at most ${MAX_LINE_OPTIONS} options.`);
  }
  const problem = validateOptionSelections(item, picks);
  if (problem) {
    throw new OrderRepoError("invalid", problem);
  }
  const priced = priceWithOptions(price, item, picks);
  const options = picks.map((pick) => {
    const group = item.options.find((candidate) => candidate.name === pick.groupName);
    const choice = group?.choices.find((candidate) => candidate.name === pick.choiceName);
    const delta = choice?.priceDelta ?? null;
    return {
      groupName: pick.groupName,
      choiceName: pick.choiceName,
      priceDeltaCents: delta === null ? null : Math.round(delta * 100),
    };
  });

  return {
    menuItemId: item.id,
    name: item.name,
    variantName,
    options,
    unitPriceCents: priced === null ? null : Math.round(priced * 100),
    quantity: request.quantity,
  };
}

/**
 * Refuse orders for a menu whose time windows do not cover `now`, judged
 * in the restaurant's zone: the windows are wall-clock times, and the
 * stored `restaurant.time_zone` says which wall clock they mean (null =
 * UTC, the fallback for a restaurant that has never saved hours).
 */
async function assertMenuOpen(db: TenancyDb, menuId: string, now: Date): Promise<void> {
  const rows = await db
    .select({ availability: menuTable.availability, timeZone: restaurantTable.timeZone })
    .from(menuTable)
    .innerJoin(restaurantTable, eq(restaurantTable.id, menuTable.restaurantId))
    .where(eq(menuTable.id, menuId));
  const availability = menuAvailabilitySchema.safeParse(rows[0]?.availability ?? []);
  if (!availability.success) {
    throw new Error(`stored menu ${menuId} has invalid availability`);
  }
  if (!isMenuOpenAt(availability.data, now, rows[0]?.timeZone ?? "UTC")) {
    throw new OrderRepoError("menu_not_live", "That menu is not being served right now.");
  }
}

/**
 * Persist resolved lines and their picks. Lines go first (returning ids),
 * then one option row per pick; options carry no identity of their own, so
 * there is nothing to upsert — a retry would double-insert, which is why the
 * caller deletes the order row when any part of the write fails.
 */
async function insertLinesWithOptions(
  db: TenancyDb,
  orderId: string,
  lines: (ResolvedLine & { menuId: string | null; menuTitle: string | null })[]
): Promise<{ lines: OrderLineRow[]; options: Map<string, OrderLineOptionRow[]> }> {
  const insertedLines = await db
    .insert(orderLineTable)
    // Columns are picked explicitly: the line's `options` ride in the
    // option table below, never in this row.
    .values(
      lines.map((line) => ({
        orderId,
        menuId: line.menuId,
        menuTitle: line.menuTitle,
        menuItemId: line.menuItemId,
        name: line.name,
        variantName: line.variantName,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
      }))
    )
    .returning();
  const optionRows = insertedLines.flatMap((inserted, index) =>
    (lines[index]?.options ?? []).map((pick) => ({
      orderLineId: inserted.id,
      groupName: pick.groupName,
      choiceName: pick.choiceName,
      priceDeltaCents: pick.priceDeltaCents,
    }))
  );
  const options = new Map<string, OrderLineOptionRow[]>();
  if (optionRows.length > 0) {
    const insertedOptions = await db.insert(orderLineOptionTable).values(optionRows).returning();
    for (const row of insertedOptions) {
      const list = options.get(row.orderLineId) ?? [];
      list.push(row);
      options.set(row.orderLineId, list);
    }
  }
  return { lines: insertedLines, options };
}

/**
 * Place an order from a public table link. Anonymous by design — the diner
 * never signs in, and nothing about them is stored.
 *
 * Server-side recomputation: every line is resolved against the *published
 * snapshot* (the menu the diner saw), so a client cannot invent a name, a
 * price, a total, or an add-on. Unpriced lines make the total `null`.
 */
/**
 * Option A (hide-until-paid): when the café takes cards online for this
 * ticket, the row is marked `payment_provider = 'stripe'` at creation so
 * the staff board can hide it until the webhook marks it paid. Counter
 * tickets keep a null provider and show immediately. Fail-closed: any
 * lookup failure behaves like pay-at-the-counter (the kitchen sees it).
 */
async function onlinePaymentIntent(
  db: TenancyDb,
  restaurantId: string,
  currency: string | null,
  totalCents: number | null
): Promise<boolean> {
  try {
    const account = await getPaymentAccount(db, restaurantId);
    const decision = resolveCheckout({
      mode: account?.mode ?? "at_venue",
      account: account
        ? {
            status: account.status,
            chargesEnabled: account.chargesEnabled,
            currency,
          }
        : null,
      order: { currency, totalCents },
    });
    return decision.mode === "online";
  } catch {
    return false;
  }
}

export async function placeOrderFromSlug(db: TenancyDb, input: PlaceOrderInput): Promise<Order> {
  const page = await getPublishedMenuByPath(db, input.restaurantSlug, input.slug);
  if (!page) {
    throw new OrderRepoError("menu_not_live", "This menu is not published.");
  }
  const { tableLabel, note } = validateOrderEnvelope(
    input.tableLabel,
    input.note,
    input.lines.length
  );
  const openAt = input.now ?? new Date();
  await assertMenuOpen(db, page.menuId, openAt);

  const doc = menuDocumentSchema.parse(page.doc);
  const items = collectItems(doc);

  const lines = input.lines.map((request) => ({
    ...resolveOrderLine(items, request),
    menuId: page.menuId,
    menuTitle: doc.title,
  }));

  const totalCents = lines.some((line) => line.unitPriceCents === null)
    ? null
    : lines.reduce((sum, line) => sum + (line.unitPriceCents ?? 0) * line.quantity, 0);

  const now = input.now ?? new Date();
  const needsCard = await onlinePaymentIntent(db, page.restaurantId, doc.currency, totalCents);
  const inserted = await db
    .insert(orderTable)
    .values({
      restaurantId: page.restaurantId,
      menuId: page.menuId,
      menuTitle: doc.title,
      tableLabel,
      currency: doc.currency,
      note,
      status: "new",
      totalCents,
      ...(needsCard ? { paymentProvider: "stripe" } : {}),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error("order creation did not produce a row");

  try {
    const inserted = await insertLinesWithOptions(db, row.id, lines);
    return toOrder(row, inserted.lines, inserted.options);
  } catch (error) {
    // The Neon HTTP driver has no interactive transactions: compensate so a
    // half-written order can never appear on the board.
    await db
      .delete(orderTable)
      .where(eq(orderTable.id, row.id))
      .catch(() => undefined);
    throw error;
  }
}

/**
 * Place one combined order across several menus from a table QR
 * (`/r/<restaurant>/t/<table>`). Each line names its menu, and the server
 * resolves every line against that menu's own published snapshot — a diner
 * still sends ids, variants, and quantities only.
 *
 * Every menu must be live, belong to the same restaurant the QR names, and
 * be open right now; otherwise the whole order is refused (no partial
 * ticket). The order row carries no single menu id — each line remembers
 * its own — and the display title joins the distinct menu titles.
 */
export async function placeTableOrder(db: TenancyDb, input: PlaceTableOrderInput): Promise<Order> {
  const { tableLabel, note } = validateOrderEnvelope(
    input.tableLabel,
    input.note,
    input.lines.length
  );
  const restaurant = await getRestaurantBySlug(db, input.restaurantSlug);
  if (!restaurant) {
    throw new OrderRepoError("menu_not_live", "This restaurant link is not live.");
  }

  const now = input.now ?? new Date();
  const pages = new Map<string, PublishedMenuPage>();
  for (const request of input.lines) {
    if (!pages.has(request.menuSlug)) {
      // Resolved inside this restaurant only: a menu slug that names
      // another café's menu answers exactly like an unpublished one, so the
      // slug gives away nothing about other tenants.
      const page = await getPublishedMenuByPath(db, input.restaurantSlug, request.menuSlug);
      if (!page) {
        throw new OrderRepoError("menu_not_live", "One of these menus is no longer published.");
      }
      pages.set(request.menuSlug, page);
    }
  }
  for (const page of pages.values()) {
    await assertMenuOpen(db, page.menuId, now);
  }

  const snapshots = new Map<string, { items: Map<string, MenuItem>; title: string }>();
  for (const page of pages.values()) {
    const doc = menuDocumentSchema.parse(page.doc);
    snapshots.set(page.menuId, { items: collectItems(doc), title: doc.title });
  }

  const lines = input.lines.map((request) => {
    const page = pages.get(request.menuSlug);
    if (!page) throw new Error(`unresolved menu slug ${request.menuSlug}`);
    const snapshot = snapshots.get(page.menuId);
    if (!snapshot) throw new Error(`unresolved menu ${page.menuId}`);
    return {
      ...resolveOrderLine(snapshot.items, request),
      menuId: page.menuId,
      menuTitle: snapshot.title,
    };
  });

  const totalCents = lines.some((line) => line.unitPriceCents === null)
    ? null
    : lines.reduce((sum, line) => sum + (line.unitPriceCents ?? 0) * line.quantity, 0);

  const titles: string[] = [];
  for (const page of pages.values()) {
    const title = snapshots.get(page.menuId)?.title ?? "";
    if (title && !titles.includes(title)) titles.push(title);
  }

  const ticketCurrency = orderCurrency([...pages.values()].map((page) => page.doc));
  const needsCard = await onlinePaymentIntent(db, restaurant.id, ticketCurrency, totalCents);
  const inserted = await db
    .insert(orderTable)
    .values({
      restaurantId: restaurant.id,
      menuId: null,
      menuTitle: titles.length > 0 ? titles.join(" + ") : restaurant.name,
      tableLabel,
      currency: ticketCurrency,
      note,
      status: "new",
      totalCents,
      ...(needsCard ? { paymentProvider: "stripe" } : {}),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error("order creation did not produce a row");

  try {
    const inserted = await insertLinesWithOptions(db, row.id, lines);
    return toOrder(row, inserted.lines, inserted.options);
  } catch (error) {
    await db
      .delete(orderTable)
      .where(eq(orderTable.id, row.id))
      .catch(() => undefined);
    throw error;
  }
}

/** One currency for the ticket when every menu agrees, else null (honest). */
function orderCurrency(docs: MenuDocument[]): string | null {
  const distinct = new Set(docs.map((doc) => doc.currency));
  if (distinct.size !== 1) return null;
  return docs[0]?.currency ?? null;
}

/**
 * Board query (owner or staff). Without `since` it returns one newest-first
 * history page: the `from`/`to` window filters in SQL (so a 24h board never
 * serializes older tickets), and `cursor` pages by keyset
 * (`createdAt`, `id`) with `nextCursor` for the next page — null when the
 * page is the last one. With `since`, everything changed after that
 * timestamp (ascending) so status edits reach other devices too, not just
 * new orders; windowing and paging do not apply to that live path.
 */
export async function listOrdersForStaff(
  db: TenancyDb,
  userId: string,
  query: StaffOrderQuery = {}
): Promise<{ orders: Order[]; serverTime: string; nextCursor: string | null }> {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 200);
  const since = query.since ? new Date(query.since) : null;
  if (query.since && Number.isNaN(since?.getTime())) {
    throw new OrderRepoError("invalid", "since must be an ISO 8601 timestamp.");
  }
  const from = query.from ? new Date(query.from) : null;
  if (query.from && Number.isNaN(from?.getTime())) {
    throw new OrderRepoError("invalid", "from must be an ISO 8601 timestamp.");
  }
  const to = query.to ? new Date(query.to) : null;
  if (query.to && Number.isNaN(to?.getTime())) {
    throw new OrderRepoError("invalid", "to must be an ISO 8601 timestamp.");
  }
  const cursor = query.cursor ? parseBoardCursor(query.cursor) : null;
  if (query.cursor && since) {
    throw new OrderRepoError("invalid", "cursor and since cannot be combined.");
  }
  if (query.restaurantId) {
    const membership = await db
      .select({ id: restaurantMembership.id })
      .from(restaurantMembership)
      .where(
        and(
          eq(restaurantMembership.userId, userId),
          eq(restaurantMembership.restaurantId, query.restaurantId)
        )
      );
    if (membership.length === 0) {
      throw new OrderRepoError("not_found", "That restaurant does not exist.");
    }
  }

  // Captured before the query: the next poll asks for anything newer than
  // this, so a row committed mid-query cannot fall between the two windows.
  const serverTime = new Date();

  // Option A (hide-until-paid): a card ticket stays off the kitchen board
  // until the webhook marks it paid (or refunded). Counter tickets (null
  // provider) always show. Direct reads (`getOrderForStaff`) still return
  // hidden rows so a payment can be reconciled by id. `ne` alone is not
  // enough: `null <> 'stripe'` is null in SQL, so null-provider rows need
  // the explicit `isNull` arm.
  const kitchenVisible = or(
    isNull(orderTable.paymentProvider),
    ne(orderTable.paymentProvider, "stripe"),
    eq(orderTable.paymentStatus, "paid"),
    eq(orderTable.paymentStatus, "refunded")
  );
  const conditions = [eq(restaurantMembership.userId, userId)];
  if (kitchenVisible) conditions.push(kitchenVisible);
  if (query.restaurantId) conditions.push(eq(orderTable.restaurantId, query.restaurantId));
  if (since) {
    conditions.push(gt(orderTable.updatedAt, since));
  } else {
    if (from) conditions.push(gte(orderTable.createdAt, from));
    if (to) conditions.push(lte(orderTable.createdAt, to));
    if (cursor) {
      // Newest-first keyset: strictly older than the previous page's last row.
      const older = or(
        lt(orderTable.createdAt, cursor.createdAt),
        and(eq(orderTable.createdAt, cursor.createdAt), lt(orderTable.id, cursor.id))
      );
      if (older) conditions.push(older);
    }
  }

  const rows = await db
    .select({ order: orderTable })
    .from(orderTable)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, orderTable.restaurantId))
    .where(and(...conditions))
    .orderBy(
      ...(since ? [asc(orderTable.updatedAt)] : [desc(orderTable.createdAt), desc(orderTable.id)])
    )
    // One extra row decides `nextCursor` without a second round trip.
    .limit(since ? limit : limit + 1);

  const page = since ? rows : rows.slice(0, limit);
  const orderRows = page.map((entry) => entry.order);
  const { lines, options } = await linesWithOptions(
    db,
    orderRows.map((row) => row.id)
  );
  const last = orderRows[orderRows.length - 1];
  return {
    orders: orderRows.map((row) => toOrder(row, lines.get(row.id) ?? [], options)),
    serverTime: iso(serverTime),
    nextCursor: !since && rows.length > limit && last ? boardCursorFor(last) : null,
  };
}

export type OrderStatusCounts = Record<OrderStatus, number>;

const EMPTY_STATUS_COUNTS: OrderStatusCounts = {
  new: 0,
  preparing: 0,
  served: 0,
  cancelled: 0,
};

/**
 * Board counts (owner or staff): one `COUNT(*) GROUP BY status` over the
 * same scope and window as the history pages, so the header can show "1,503
 * total" without materializing a single ticket. Lines are never read here.
 */
export async function countOrdersForStaff(
  db: TenancyDb,
  userId: string,
  query: { restaurantId?: string | null; from?: string | null; to?: string | null } = {}
): Promise<{ counts: OrderStatusCounts; total: number; serverTime: string }> {
  if (!query.restaurantId) {
    throw new OrderRepoError("invalid", "restaurantId is required for counts.");
  }
  const from = query.from ? new Date(query.from) : null;
  if (query.from && Number.isNaN(from?.getTime())) {
    throw new OrderRepoError("invalid", "from must be an ISO 8601 timestamp.");
  }
  const to = query.to ? new Date(query.to) : null;
  if (query.to && Number.isNaN(to?.getTime())) {
    throw new OrderRepoError("invalid", "to must be an ISO 8601 timestamp.");
  }
  const membership = await db
    .select({ id: restaurantMembership.id })
    .from(restaurantMembership)
    .where(
      and(
        eq(restaurantMembership.userId, userId),
        eq(restaurantMembership.restaurantId, query.restaurantId)
      )
    );
  if (membership.length === 0) {
    throw new OrderRepoError("not_found", "That restaurant does not exist.");
  }

  const serverTime = new Date();
  const hideUnpaidCard = or(
    isNull(orderTable.paymentProvider),
    ne(orderTable.paymentProvider, "stripe"),
    eq(orderTable.paymentStatus, "paid"),
    eq(orderTable.paymentStatus, "refunded")
  );
  const conditions = [
    eq(orderTable.restaurantId, query.restaurantId),
    // Same hide-until-paid rule as the board list, so the header total
    // never counts tickets the board hides.
    ...(hideUnpaidCard ? [hideUnpaidCard] : []),
    ...(from ? [gte(orderTable.createdAt, from)] : []),
    ...(to ? [lte(orderTable.createdAt, to)] : []),
  ];
  const rows = await db
    .select({ status: orderTable.status, count: sql<number>`count(*)::int` })
    .from(orderTable)
    .where(and(...conditions))
    .groupBy(orderTable.status);
  const counts: OrderStatusCounts = { ...EMPTY_STATUS_COUNTS };
  for (const row of rows) counts[row.status] = row.count;
  return {
    counts,
    total: counts.new + counts.preparing + counts.served + counts.cancelled,
    serverTime: iso(serverTime),
  };
}

/**
 * Tickets the kitchen board hides (Option A): card orders not yet paid.
 * The slim strip above the Kanban reads this — paid/refunded rows never
 * appear here because the board already shows them. Capped at 50, newest
 * first; cash-only cafés simply get an empty list.
 */
export async function listAwaitingPaymentForStaff(
  db: TenancyDb,
  userId: string,
  query: { restaurantId?: string | null } = {}
): Promise<{ orders: Order[]; serverTime: string }> {
  if (query.restaurantId) {
    const membership = await db
      .select({ id: restaurantMembership.id })
      .from(restaurantMembership)
      .where(
        and(
          eq(restaurantMembership.userId, userId),
          eq(restaurantMembership.restaurantId, query.restaurantId)
        )
      );
    if (membership.length === 0) {
      throw new OrderRepoError("not_found", "That restaurant does not exist.");
    }
  }
  const serverTime = new Date();
  const conditions = [
    eq(restaurantMembership.userId, userId),
    eq(orderTable.paymentProvider, "stripe"),
    inArray(orderTable.paymentStatus, ["unpaid", "pending", "failed"]),
    ...(query.restaurantId ? [eq(orderTable.restaurantId, query.restaurantId)] : []),
  ];
  const rows = await db
    .select({ order: orderTable })
    .from(orderTable)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, orderTable.restaurantId))
    .where(and(...conditions))
    .orderBy(desc(orderTable.createdAt), desc(orderTable.id))
    .limit(50);
  const orderRows = rows.map((entry) => entry.order);
  const { lines, options } = await linesWithOptions(
    db,
    orderRows.map((row) => row.id)
  );
  return {
    orders: orderRows.map((row) => toOrder(row, lines.get(row.id) ?? [], options)),
    serverTime: iso(serverTime),
  };
}

/** One order for a member of its restaurant (owner or staff), or null. */
export async function getOrderForStaff(
  db: TenancyDb,
  userId: string,
  orderId: string
): Promise<Order | null> {
  const rows = await db
    .select({ order: orderTable })
    .from(orderTable)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, orderTable.restaurantId))
    .where(and(eq(orderTable.id, orderId), eq(restaurantMembership.userId, userId)));
  const row = rows[0]?.order;
  if (!row) return null;
  const { lines, options } = await linesWithOptions(db, [row.id]);
  return toOrder(row, lines.get(row.id) ?? [], options);
}

/**
 * Move an order forward (or cancel it). `expectedUpdatedAt` makes the write
 * conditional: two devices updating the same order converge through a
 * `stale` result rather than the later write silently winning.
 */
export async function updateOrderStatusForStaff(
  db: TenancyDb,
  userId: string,
  orderId: string,
  status: OrderStatus,
  expectedUpdatedAt?: string | null
): Promise<Order> {
  if (!orderStatusSchema.safeParse(status).success) {
    throw new OrderRepoError("invalid", "Unknown order status.");
  }
  const current = await getOrderForStaff(db, userId, orderId);
  if (!current) {
    throw new OrderRepoError("not_found", "That order does not exist.");
  }
  if (!canTransitionOrderStatus(current.status, status)) {
    throw new OrderRepoError(
      "invalid",
      `An order cannot move from ${current.status} to ${status}.`
    );
  }
  if (current.status === status) return current;

  const now = new Date();
  if (expectedUpdatedAt) {
    const expected = new Date(expectedUpdatedAt);
    if (Number.isNaN(expected.getTime())) {
      throw new OrderRepoError("invalid", "expectedUpdatedAt must be an ISO 8601 timestamp.");
    }
    // Stale check in JS, not SQL: `updated_at` is `timestamp without tz`
    // (wall time) while the wire is a UTC ISO string, so any SQL cast
    // (`::timestamp` vs `::timestamptz`) depends on the DB session TimeZone
    // and 409s forever on some hosts (Sydney wall vs UTC wire differed by
    // 11h). JS Dates are absolute instants on both sides, and the pg driver
    // already truncates stored microseconds to ms — so getTime() compares
    // exactly what the board saw.
    if (new Date(current.updatedAt).getTime() !== expected.getTime()) {
      throw new OrderRepoError(
        "stale",
        "This order was changed elsewhere since you last saw it.",
        current
      );
    }
  }

  // Guard the write on the status read above: a concurrent status move
  // 409s instead of silently winning, while a payment-only touch (webhook
  // marking paid, same status) never blocks the kitchen's Start/Serve.
  const updated = await db
    .update(orderTable)
    .set({ status, updatedAt: now })
    .where(and(eq(orderTable.id, orderId), eq(orderTable.status, current.status)))
    .returning();

  if (updated.length === 0) {
    const fresh = await getOrderForStaff(db, userId, orderId);
    throw new OrderRepoError(
      "stale",
      "This order was changed elsewhere since you last saw it.",
      fresh
    );
  }

  const { lines, options } = await linesWithOptions(db, [orderId]);
  return toOrder(updated[0], lines.get(orderId) ?? [], options);
}

/**
 * Count one order attempt against a fixed-window bucket. The bucket key is
 * supplied by the route (a hash — no raw address is stored) and already
 * includes the window; the upsert is atomic, so concurrent attempts on
 * different instances still share one count.
 */
export async function consumeOrderRateLimit(
  db: TenancyDb,
  bucket: string,
  now: Date,
  limit: number = ORDER_RATE_LIMIT_PER_WINDOW
): Promise<{ allowed: boolean; count: number }> {
  const rows = await db
    .insert(orderRateLimit)
    .values({ key: bucket, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: orderRateLimit.key,
      set: { count: sql`${orderRateLimit.count} + 1` },
    })
    .returning({ count: orderRateLimit.count });
  const count = rows[0]?.count ?? 1;
  return { allowed: count <= limit, count };
}

/**
 * Diner order tracking (v1): a per-order bearer token, read-only and scoped
 * to that order. Locked decisions: 7-day hard cap, 24h after terminal
 * status, sessionStorage resume, same-device + opt-in link.
 *
 * The raw token is returned once and never stored — only its SHA-256 hash.
 * A miss (unknown hash, expired, or terminally old) answers `null` so the
 * route can return one generic 404 without revealing which case it was.
 */

export const TRACK_TOKEN_BYTES = 32;
export const TRACK_HARD_CAP_MS = 7 * 24 * 60 * 60 * 1000;
export const TRACK_TERMINAL_GRACE_MS = 24 * 60 * 60 * 1000;
/** The track route's own bucket: polling must never eat the POST 12/min one. */
export const TRACK_RATE_LIMIT_PER_WINDOW = 60;

export function hashTrackingToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mint one tracking token for an order; the raw value is returned once. */
export async function createOrderTrackingToken(
  db: TenancyDb,
  orderId: string,
  now: Date = new Date()
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(TRACK_TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(now.getTime() + TRACK_HARD_CAP_MS);
  await db.insert(orderTrackingTable).values({
    orderId,
    tokenHash: hashTrackingToken(token),
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * Resolve a presented token to its order, or `null` when unknown, expired,
 * or past the terminal grace window. Lazy expiry only — no scheduled sweep.
 */
export async function getOrderByTrackingToken(
  db: TenancyDb,
  rawToken: string,
  now: Date = new Date()
): Promise<Order | null> {
  const presented = rawToken.trim();
  if (!presented || presented.length > 256) return null;
  const tokenHash = hashTrackingToken(presented);
  const rows = await db
    .select({ tracking: orderTrackingTable, order: orderTable })
    .from(orderTrackingTable)
    .innerJoin(orderTable, eq(orderTable.id, orderTrackingTable.orderId))
    .where(eq(orderTrackingTable.tokenHash, tokenHash))
    .limit(1);
  const found = rows[0];
  if (!found) return null;
  if (found.tracking.expiresAt.getTime() <= now.getTime()) return null;
  const status = found.order.status;
  if (
    (status === "served" || status === "cancelled") &&
    found.order.updatedAt.getTime() + TRACK_TERMINAL_GRACE_MS <= now.getTime()
  ) {
    return null;
  }
  const { lines, options } = await linesWithOptions(db, [found.order.id]);
  return toOrder(found.order, lines.get(found.order.id) ?? [], options);
}
