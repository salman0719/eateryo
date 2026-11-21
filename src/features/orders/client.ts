/**
 * Typed browser client for the orders API. Client-safe: HTTP only, no Drizzle
 * and no server repository imports.
 *
 * Every response is re-validated with the canonical order schema, so a
 * malformed payload fails as `SyncError("unavailable")` instead of putting a
 * half-order on the board. Error mapping follows the app's shared taxonomy:
 * 401 unauthorized, 403 forbidden, 404 not_found, 409 conflict (a stale
 * status write — reload and decide again), 400 invalid, 429 rate_limited,
 * anything else unavailable.
 */

import { z } from "zod";

import { SyncError, type SyncErrorCode } from "@/features/menus/sync";

import { orderSchema, orderStatusSchema, type Order, type OrderStatus } from "./schema";

const orderEnvelope = z.object({ order: orderSchema });
const placedEnvelope = z.object({
  order: orderSchema,
  tracking: z.object({ token: z.string().min(1), expiresAt: z.string().min(1) }).optional(),
});
const trackEnvelope = z.object({
  order: orderSchema,
  serverTime: z.string().min(1),
});
const boardEnvelope = z.object({
  orders: z.array(orderSchema),
  serverTime: z.string().min(1),
  nextCursor: z.string().min(1).nullable().optional(),
  // The awaiting-payment pill rides the board poll: hidden card tickets
  // arrive in the same response, so the strip needs no second request.
  awaiting: z.object({
    orders: z.array(orderSchema),
    serverTime: z.string().min(1),
  }),
});

const countsEnvelope = z.object({
  counts: z.record(orderStatusSchema, z.number().int().nonnegative()),
  total: z.number().int().nonnegative(),
  serverTime: z.string().min(1),
});

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export interface PlaceOrderRequest {
  /** Single-menu path: the menu's own address segment. Omit on the table path. */
  slug?: string;
  /**
   * The restaurant's public slug. Required on both paths: alongside `slug`
   * on the single-menu path so the server resolves the menu inside that
   * café, and on its own on the table path (where every line names its menu).
   */
  restaurantSlug: string;
  tableLabel: string;
  note: string | null;
  lines: {
    menuSlug?: string;
    menuItemId: string;
    variantName: string | null;
    options?: { groupName: string; choiceName: string }[];
    quantity: number;
  }[];
  /** Honeypot — always empty for a human; the server refuses filled values. */
  website: string;
}

function mapErrorCode(code: string, status: number): SyncErrorCode {
  switch (code) {
    case "unauthorized":
      return "unauthorized";
    case "forbidden":
      return "forbidden";
    case "not_found":
    case "menu_not_live":
      return "not_found";
    case "order_stale":
    case "already_paid":
      return "conflict";
    case "order_expired":
      return "invalid";
    case "pay_unavailable":
    case "no_session":
      return "invalid";
    case "rate_limited":
      return "rate_limited";
    case "invalid_body":
      return "invalid";
    case "server_db_unavailable":
      return "unavailable";
    default:
      break;
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 400) return "invalid";
  return "unavailable";
}

async function requestJson<T>(
  path: string,
  init: RequestInit | undefined,
  decode: (payload: unknown) => T
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new SyncError("unavailable", "Could not reach the server. Check your connection.");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const envelope = errorEnvelope.safeParse(payload);
    if (envelope.success) {
      throw new SyncError(
        mapErrorCode(envelope.data.error.code, response.status),
        envelope.data.error.message
      );
    }
    throw new SyncError("unavailable", `The server responded ${response.status}.`);
  }

  try {
    return decode(payload);
  } catch {
    throw new SyncError(
      "unavailable",
      "The server sent data this app could not understand. Try again in a moment."
    );
  }
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Place an order from a public table link (no account required). */
export async function placeOrder(input: PlaceOrderRequest): Promise<Order> {
  const placed = await placeOrderWithTracking(input);
  return placed.order;
}

export interface PlacedOrder {
  order: Order;
  /** Present only on server-placed orders; absent on legacy/demo flows. */
  tracking: { token: string; expiresAt: string } | null;
}

/** Place an order and keep the one-time tracking token when the server issues one. */
export async function placeOrderWithTracking(input: PlaceOrderRequest): Promise<PlacedOrder> {
  return requestJson("/api/orders", jsonInit("POST", input), (payload) => {
    const parsed = placedEnvelope.parse(payload);
    return { order: parsed.order, tracking: parsed.tracking ?? null };
  });
}

/**
 * Public diner status read: resolve one tracking token to its order.
 * Generic 404 when the link is unknown or expired — the copy stays
 * "ask staff", never "this order exists but the token is wrong".
 */
export async function fetchTrackedOrder(
  token: string
): Promise<{ order: Order; serverTime: string }> {
  const params = new URLSearchParams({ token });
  return requestJson(`/api/orders/track?${params.toString()}`, undefined, (payload) =>
    trackEnvelope.parse(payload)
  );
}

/**
 * Board query. Without `since` it returns one newest-first history page
 * (`from`/`to` narrow the window in SQL, `cursor` continues the page);
 * with `since`, every order changed after that server timestamp (status
 * edits included). `nextCursor` is null on the last page and on `since`.
 * Every response also carries the awaiting-payment snapshot, so the strip
 * above the Kanban follows the same poll instead of fetching on its own.
 */
export async function fetchStaffOrders(
  options: {
    since?: string | null;
    restaurantId?: string | null;
    limit?: number;
    from?: string | null;
    to?: string | null;
    cursor?: string | null;
  } = {}
): Promise<{
  orders: Order[];
  serverTime: string;
  nextCursor: string | null;
  awaiting: { orders: Order[]; serverTime: string };
}> {
  const params = new URLSearchParams();
  if (options.since) params.set("since", options.since);
  if (options.restaurantId) params.set("restaurantId", options.restaurantId);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  if (options.cursor) params.set("cursor", options.cursor);
  const query = params.toString();
  return requestJson(`/api/orders${query ? `?${query}` : ""}`, undefined, (payload) => {
    const parsed = boardEnvelope.parse(payload);
    return {
      orders: parsed.orders,
      serverTime: parsed.serverTime,
      nextCursor: parsed.nextCursor ?? null,
      awaiting: parsed.awaiting,
    };
  });
}

/**
 * Board totals: one cheap `COUNT(*) GROUP BY status` over the same
 * restaurant + window scope as the history pages. No tickets attached.
 */
export async function fetchStaffOrderCounts(options: {
  restaurantId: string;
  from?: string | null;
  to?: string | null;
}): Promise<{ counts: Record<OrderStatus, number>; total: number; serverTime: string }> {
  const params = new URLSearchParams({ restaurantId: options.restaurantId });
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  return requestJson(`/api/orders/counts?${params.toString()}`, undefined, (payload) =>
    countsEnvelope.parse(payload)
  );
}

const checkoutEnvelope = z.object({
  url: z.string().min(1),
  sessionId: z.string().min(1),
  reused: z.boolean(),
});

const paymentEnvelope = z.object({
  paymentStatus: z.string().nullable(),
  paymentProvider: z.string().nullable(),
  checkout: z.object({
    mode: z.enum(["online", "at_venue"]),
    reason: z.string().min(1),
    copy: z.string().min(1),
  }),
  live: z.object({ paid: z.boolean(), state: z.string().min(1) }).nullable(),
});

const paymentCheckEnvelope = z.object({
  paymentStatus: z.string().nullable(),
  reconciled: z.boolean(),
});

export interface CheckoutStart {
  url: string;
  sessionId: string;
  reused: boolean;
}

export interface OrderPaymentRead {
  paymentStatus: string | null;
  paymentProvider: string | null;
  checkout: { mode: "online" | "at_venue"; reason: string; copy: string };
  live: { paid: boolean; state: string } | null;
}

/**
 * Start (or resume) card payment for a diner order. The tracking token is
 * the only proof — anonymous by design. Returns the hosted Checkout URL;
 * the caller leaves the page for it (`window.location.href = url`).
 */
export async function startCheckout(
  orderId: string,
  trackingToken: string
): Promise<CheckoutStart> {
  return requestJson(
    `/api/orders/${encodeURIComponent(orderId)}/checkout`,
    jsonInit("POST", { trackingToken }),
    (payload) => checkoutEnvelope.parse(payload)
  );
}

/** What the receipt needs: stored payment state plus the checkout decision. */
export async function fetchOrderPayment(
  orderId: string,
  trackingToken: string,
  sessionId?: string | null
): Promise<OrderPaymentRead> {
  return requestJson(
    `/api/orders/${encodeURIComponent(orderId)}/payment`,
    jsonInit("POST", sessionId ? { trackingToken, sessionId } : { trackingToken }),
    (payload) => paymentEnvelope.parse(payload)
  );
}

/**
 * Staff reconciliation for the missed-webhook case. Reads the session off
 * the café's account and applies the paid transition when Stripe says so.
 */
export async function checkOrderPayment(
  orderId: string
): Promise<{ paymentStatus: string | null; reconciled: boolean }> {
  return requestJson(
    `/api/orders/${encodeURIComponent(orderId)}/payment-check`,
    jsonInit("POST", {}),
    (payload) => paymentCheckEnvelope.parse(payload)
  );
}

/**
 * Move an order's status. Pass the `updatedAt` last seen so a concurrent
 * change from another device results in `SyncError("conflict")` rather than
 * an overwrite.
 */
export async function setOrderStatus(
  orderId: string,
  status: OrderStatus,
  expectedUpdatedAt?: string | null
): Promise<Order> {
  return requestJson(
    `/api/orders/${encodeURIComponent(orderId)}`,
    jsonInit("PATCH", {
      status,
      ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    }),
    (payload) => orderEnvelope.parse(payload).order
  );
}
