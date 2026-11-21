import { eq } from "drizzle-orm";

import type { TenancyDb } from "@/features/tenancy/repo";
import { can, getMembershipAccess } from "@/features/tenancy/policy";
import { restaurantPaymentAccount } from "@/lib/db/schema";

import { mapAccountStatus } from "./repo";
import type { AccountStatusRead } from "./provider";

export type PaymentAccountRow = typeof restaurantPaymentAccount.$inferSelect;

/** The café's Stripe row, or null when it never connected (the default). */
export async function getPaymentAccount(
  db: TenancyDb,
  restaurantId: string
): Promise<PaymentAccountRow | null> {
  const rows = await db
    .select()
    .from(restaurantPaymentAccount)
    .where(eq(restaurantPaymentAccount.restaurantId, restaurantId))
    .limit(1);
  return rows[0] ?? null;
}

/** Member-scoped read: any member may see the status; outsiders get null. */
export async function getPaymentAccountForMember(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<PaymentAccountRow | null> {
  const access = await getMembershipAccess(db, userId, restaurantId);
  if (!access) return null;
  return getPaymentAccount(db, restaurantId);
}

/**
 * Link (or relink) the café to a Connect account. Owner-only; returns null
 * when the caller may not write. One row per restaurant: a second connect
 * reuses the row and yields one `acct_`, never two.
 */
export async function linkPaymentAccountForOwner(
  db: TenancyDb,
  userId: string,
  restaurantId: string,
  input: { externalAccountId: string; livemode: boolean }
): Promise<PaymentAccountRow | null> {
  const access = await getMembershipAccess(db, userId, restaurantId);
  if (!can(access, "settings.manage")) return null;
  const existing = await getPaymentAccount(db, restaurantId);
  const now = new Date();
  if (!existing) {
    const inserted = await db
      .insert(restaurantPaymentAccount)
      .values({
        restaurantId,
        provider: "stripe",
        mode: "at_venue",
        livemode: input.livemode,
        externalAccountId: input.externalAccountId,
        status: "pending",
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        connectedAt: now,
        statusCheckedAt: now,
      })
      .returning();
    return inserted[0] ?? null;
  }
  // A different `acct_` replaces the old one (fresh onboarding); the same
  // one is a no-op touch so "press connect twice" stays one account.
  const updated = await db
    .update(restaurantPaymentAccount)
    .set({
      externalAccountId: input.externalAccountId,
      livemode: input.livemode,
      status: "pending",
      chargesEnabled: false,
      payoutsEnabled: false,
      statusCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(restaurantPaymentAccount.id, existing.id))
    .returning();
  return updated[0] ?? null;
}

/** Owner-only mode switch (`online` vs pay-at-the-counter). */
export async function setPaymentModeForOwner(
  db: TenancyDb,
  userId: string,
  restaurantId: string,
  mode: "online" | "at_venue"
): Promise<PaymentAccountRow | null> {
  const access = await getMembershipAccess(db, userId, restaurantId);
  if (!can(access, "settings.manage")) return null;
  const existing = await getPaymentAccount(db, restaurantId);
  const now = new Date();
  if (!existing) {
    if (mode === "at_venue") return null;
    return null;
  }
  const updated = await db
    .update(restaurantPaymentAccount)
    .set({ mode, updatedAt: now })
    .where(eq(restaurantPaymentAccount.id, existing.id))
    .returning();
  return updated[0] ?? null;
}

/**
 * Turn card payment off: back to `at_venue`, connection kept. There is no
 * hard disconnect in v1 — the café's Stripe account stays theirs.
 */
export async function disableOnlinePaymentsForOwner(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<PaymentAccountRow | null> {
  return setPaymentModeForOwner(db, userId, restaurantId, "at_venue");
}

/** Sync the cached verdict from a fresh Stripe read. */
export async function syncPaymentAccountStatus(
  db: TenancyDb,
  rowId: string,
  read: AccountStatusRead
): Promise<PaymentAccountRow | null> {
  const now = new Date();
  const updated = await db
    .update(restaurantPaymentAccount)
    .set({
      chargesEnabled: read.chargesEnabled,
      payoutsEnabled: read.payoutsEnabled,
      detailsSubmitted: read.detailsSubmitted,
      country: read.country,
      defaultCurrency: read.defaultCurrency,
      requirementCodes: read.requirementCodes,
      status: mapAccountStatus(read),
      statusCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(restaurantPaymentAccount.id, rowId))
    .returning();
  return updated[0] ?? null;
}
