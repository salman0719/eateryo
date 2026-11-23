/**
 * Typed browser client for the café payments API. HTTP only, no Drizzle,
 * no secrets — the publishable key never appears here (hosted onboarding
 * and hosted Checkout need none in our pages).
 */

import { z } from "zod";

import { SyncError } from "@/features/menus/sync";

const currencyWarningSchema = z.object({
  menuTitle: z.string().min(1),
  currency: z.string().nullable(),
});

export type CurrencyWarning = z.infer<typeof currencyWarningSchema>;

const accountSchema = z.object({
  id: z.string().min(1),
  provider: z.literal("stripe"),
  mode: z.enum(["online", "at_venue"]),
  livemode: z.boolean(),
  externalAccountId: z.string().min(1),
  status: z.enum(["pending", "active", "restricted", "unavailable"]),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  detailsSubmitted: z.boolean(),
  country: z.string().nullable(),
  defaultCurrency: z.string().nullable(),
  requirementCodes: z.array(z.string()),
  connectedAt: z.string().nullable(),
  statusCheckedAt: z.string().nullable(),
  // Present on the status read and the mode switch; older sibling routes
  // omit it and the card keeps its previous warnings.
  currencyWarnings: z.array(currencyWarningSchema).optional(),
});

export type PaymentsAccount = z.infer<typeof accountSchema>;

const statusEnvelope = z.object({ account: accountSchema.nullable() });
const linkEnvelope = z.object({ url: z.string().url(), expiresAt: z.number().nullable() });
const modeEnvelope = z.object({ account: accountSchema });

function errorCode(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const error = (payload as { error?: { code?: unknown } }).error;
  return typeof error?.code === "string" ? error.code : null;
}

async function readEnvelope<T>(
  response: Response,
  schema: z.ZodType<T>,
  fallback: string
): Promise<T> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    throw new SyncError("unavailable", fallback);
  }
  if (!response.ok) {
    const code = errorCode(payload);
    if (response.status === 401) throw new SyncError("unauthorized", "Sign in to continue.");
    if (response.status === 403)
      throw new SyncError("forbidden", "Only an owner can change card payments.");
    if (response.status === 404)
      throw new SyncError("not_found", "That restaurant does not exist.");
    if (response.status === 503)
      throw new SyncError("unavailable", "Payments are unavailable. Try again.");
    throw new SyncError(code === "invalid_body" ? "invalid" : "unavailable", fallback);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new SyncError("unavailable", fallback);
  return parsed.data;
}

async function post<T>(
  url: string,
  body: unknown,
  schema: z.ZodType<T>,
  fallback: string
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    credentials: "same-origin",
  });
  return readEnvelope(response, schema, fallback);
}

/** Status the Settings card renders; null when the café never connected. */
export async function fetchPaymentsStatus(restaurantId: string): Promise<PaymentsAccount | null> {
  const response = await fetch(`/api/restaurants/${restaurantId}/payments`, {
    credentials: "same-origin",
  });
  const data = await readEnvelope(response, statusEnvelope, "Could not load card payments.");
  return data.account;
}

/** Start (or resume) onboarding; returns the Stripe URL to send the owner to. */
export async function startPaymentsConnect(
  restaurantId: string
): Promise<{ url: string; expiresAt: number | null }> {
  return post(
    `/api/restaurants/${restaurantId}/payments/connect`,
    {},
    linkEnvelope,
    "Could not start the Stripe connection. Try again."
  );
}

/** Mint a fresh onboarding link when the old one expired. */
export async function refreshPaymentsLink(
  restaurantId: string
): Promise<{ url: string; expiresAt: number | null }> {
  return post(
    `/api/restaurants/${restaurantId}/payments/refresh`,
    {},
    linkEnvelope,
    "That link expired. Try a fresh one."
  );
}

/** Re-read Stripe instead of the cache ("Check again"). */
export async function checkPaymentsNow(restaurantId: string): Promise<PaymentsAccount | null> {
  const data = await post(
    `/api/restaurants/${restaurantId}/payments/check`,
    {},
    statusEnvelope,
    "Could not check with Stripe. Try again."
  );
  return data.account;
}

/** Owner-only mode switch. */
export async function setPaymentsMode(
  restaurantId: string,
  mode: "online" | "at_venue"
): Promise<PaymentsAccount> {
  const response = await fetch(`/api/restaurants/${restaurantId}/payments`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
    credentials: "same-origin",
  });
  const data = await readEnvelope(response, modeEnvelope, "Could not change the payment mode.");
  return data.account;
}

/** Back to pay-at-the-counter; the Stripe connection is kept. */
export async function disableOnlinePayments(restaurantId: string): Promise<PaymentsAccount | null> {
  const data = await post(
    `/api/restaurants/${restaurantId}/payments/disable`,
    {},
    statusEnvelope,
    "Could not turn card payment off."
  );
  return data.account;
}
