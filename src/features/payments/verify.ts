import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe webhook signature verification (Commit 2), without the `stripe`
 * package — the webhook needs only this one algorithm, and a dependency
 * that also mints sessions and charges would widen the install for a route
 * that must never do either. (Commit 3 adds the SDK for Checkout creation.)
 *
 * Stripe's scheme: `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]`, where
 * the signature is HMAC-SHA256(`<t>.<raw body>`) under the endpoint's
 * webhook secret. Verification refuses a missing or malformed header, a
 * body that matches no `v1` signature (compared in constant time), and a
 * timestamp outside the tolerance window — a captured body cannot be
 * replayed forever.
 */

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
  "missing_header" | "malformed_header" | "no_v1_signature" | "stale_timestamp" | "mismatch";

export interface SignatureCheck {
  ok: boolean;
  failure?: SignatureFailure;
}

function parseHeader(header: string): { timestamp: number; signatures: string[] } | null {
  const parts = header.split(",").map((part) => part.trim());
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator < 0) return null;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (!value) return null;
    if (key === "t") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) return null;
      timestamp = parsed;
    } else if (key === "v1") {
      signatures.push(value);
    }
    // `v0` and future schemes are ignored, never trusted.
  }
  if (timestamp === null) return null;
  return { timestamp, signatures };
}

function signaturesMatch(expectedHex: string, candidates: string[]): boolean {
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }
  for (const candidate of candidates) {
    let actual: Buffer;
    try {
      actual = Buffer.from(candidate, "hex");
    } catch {
      continue;
    }
    if (actual.length !== expected.length) continue;
    if (timingSafeEqual(actual, expected)) return true;
  }
  return false;
}

/**
 * Verify a webhook delivery. `nowSeconds` is injectable so tests pin the
 * clock instead of depending on delivery time.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): SignatureCheck {
  if (!header) return { ok: false, failure: "missing_header" };
  const parsed = parseHeader(header);
  if (!parsed) return { ok: false, failure: "malformed_header" };
  if (parsed.signatures.length === 0) return { ok: false, failure: "no_v1_signature" };
  if (Math.abs(nowSeconds - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, failure: "stale_timestamp" };
  }
  const signed = `${parsed.timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signed, "utf8").digest("hex");
  if (!signaturesMatch(expected, parsed.signatures)) {
    return { ok: false, failure: "mismatch" };
  }
  return { ok: true };
}

/** Build a valid test header for `rawBody` (tests and the dev harness only). */
export function signTestPayload(
  rawBody: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000)
): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}
