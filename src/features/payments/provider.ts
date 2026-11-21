/**
 * Server-only Stripe provider wrapper (Commit 2).
 *
 * Direct charges on the café's own account (`Stripe-Account: acct_…`),
 * never the platform balance; no `application_fee_amount` anywhere in v1.
 * The webhook route never imports this — it verifies with `node:crypto`
 * only, so a dependency that mints sessions can never widen into a route
 * that must never charge. Commit 3 adds the Checkout SDK path; this file
 * covers onboarding only (account create, account link, status read).
 *
 * HTTP goes through injectable `fetchImpl` so tests stub Stripe instead of
 * calling it. API version is pinned: capability status paths move between
 * versions, and a parse failure must read as `unavailable`, never `active`.
 */

export const STRIPE_API_VERSION = "2026-11-18.endive";

export type FetchImpl = typeof fetch;

export interface CoreAccountInput {
  email?: string;
  country?: string;
}

export interface StripeAccountRef {
  id: string;
  livemode: boolean;
}

export interface AccountStatusRead {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  country: string | null;
  defaultCurrency: string | null;
  requirementCodes: string[];
}

/** Which secret the server may use in this environment. */
export function stripeSecretFor(env: { STRIPE_SECRET_KEY?: string; NODE_ENV?: string }): {
  secret: string | null;
  error: string | null;
} {
  const secret = env.STRIPE_SECRET_KEY?.trim() || null;
  if (!secret) return { secret: null, error: "missing" };
  const isLive = secret.startsWith("sk_live_");
  const isTest = secret.startsWith("sk_test_") || secret.startsWith("rk_test_");
  if (!isLive && !isTest) return { secret: null, error: "unrecognized" };
  if (isLive && env.NODE_ENV !== "production") {
    return { secret: null, error: "live_key_outside_production" };
  }
  if (!isLive && env.NODE_ENV === "production") {
    return { secret: null, error: "test_key_in_production" };
  }
  return { secret, error: null };
}

/** Server secret or null (never throws, never logs the value). */
export function getStripeSecret(): string | null {
  const { secret } = stripeSecretFor({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    NODE_ENV: process.env.NODE_ENV,
  });
  return secret;
}

function authHeaders(secret: string, idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    "stripe-version": STRIPE_API_VERSION,
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return headers;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Create the café's full-dashboard Connect account (Accounts v2). Idempotent
 * per restaurant via the caller's idempotency key — pressing connect twice
 * must yield one `acct_`.
 */
export async function createCoreAccount(
  secret: string,
  input: CoreAccountInput,
  opts?: { fetchImpl?: FetchImpl; idempotencyKey?: string }
): Promise<StripeAccountRef> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const body = new URLSearchParams();
  body.set("dashboard", "full");
  body.set("defaults[fees_collector]", "stripe");
  body.set("defaults[losses_collector]", "stripe");
  body.set("defaults[country]", input.country ?? "AU");
  body.set("configuration[merchant][card_payments]", "true");
  body.set("configuration[merchant][support_phone]", "false");
  body.set("identity[business_details][country]", input.country ?? "AU");
  if (input.email) body.set("contact_email", input.email);

  const response = await fetchImpl("https://api.stripe.com/v2/core/accounts", {
    method: "POST",
    headers: {
      ...authHeaders(secret, opts?.idempotencyKey),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`stripe_account_create_failed:${response.status}`);
  const json = await readJson(response);
  const id = asString(json["id"]);
  if (!id) throw new Error("stripe_account_create_failed:missing_id");
  return { id, livemode: json["livemode"] === true };
}

/** Mint a fresh onboarding link; every press mints a new one. */
export async function createAccountLink(
  secret: string,
  input: { accountId: string; returnUrl: string; refreshUrl: string },
  opts?: { fetchImpl?: FetchImpl }
): Promise<{ url: string; expiresAt: number | null }> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const body = new URLSearchParams();
  body.set("account", input.accountId);
  body.set("type", "account_onboarding");
  body.set("return_url", input.returnUrl);
  body.set("refresh_url", input.refreshUrl);

  const response = await fetchImpl("https://api.stripe.com/v1/account_links", {
    method: "POST",
    headers: { ...authHeaders(secret), "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`stripe_account_link_failed:${response.status}`);
  const json = await readJson(response);
  const url = asString(json["url"]);
  if (!url) throw new Error("stripe_account_link_failed:missing_url");
  const expiresAt = typeof json["expires_at"] === "number" ? json["expires_at"] : null;
  return { url, expiresAt };
}

/**
 * Read what the onboarding actually achieved. Unknown shapes read as
 * "cannot charge" — never as active.
 */
export async function retrieveAccountStatus(
  secret: string,
  accountId: string,
  opts?: { fetchImpl?: FetchImpl }
): Promise<AccountStatusRead> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`,
    { method: "GET", headers: authHeaders(secret) }
  );
  if (!response.ok) throw new Error(`stripe_account_read_failed:${response.status}`);
  const json = await readJson(response);
  const chargesEnabled = asBool(json["charges_enabled"]) ?? false;
  const payoutsEnabled = asBool(json["payouts_enabled"]) ?? false;
  const detailsSubmitted = asBool(json["details_submitted"]) ?? false;
  const requirements =
    typeof json["requirements"] === "object" && json["requirements"] !== null
      ? (json["requirements"] as Record<string, unknown>)
      : {};
  const rawCodes = requirements["currently_due"];
  const requirementCodes = Array.isArray(rawCodes)
    ? rawCodes.filter((code): code is string => typeof code === "string")
    : [];
  return {
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    country: asString(json["country"]),
    defaultCurrency: asString(json["default_currency"]),
    requirementCodes,
  };
}
