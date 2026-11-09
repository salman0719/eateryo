/**
 * Server-side launch snapshot: what one café actually has, so the onboarding
 * checklist reports facts rather than a guessed progress bar.
 *
 * Scoped to one membership at a time: an account that owns one café and works
 * a shift at another must not see the other café's menus or orders in this
 * count. Every query also joins membership on the verified user id, so a
 * client-supplied restaurant id can never widen the read. Review counts come
 * from documents re-validated with the canonical menu schema — an unreadable
 * menu is counted, not hidden.
 */

import { and, count, desc, eq, isNotNull } from "drizzle-orm";

import { getAssistantSpendSummary } from "@/features/assistant/repo";
import { hasAnyPrice } from "@/features/menu/menu-utils";
import { menuDocumentSchema } from "@/features/menu/schema";
import type { TenancyDb } from "@/features/tenancy/repo";
import { getMonthlyUsageSummary } from "@/features/usage/repo";
import { menu, order, publishedMenu, restaurantMembership } from "@/lib/db/schema";

import type { LaunchSnapshot, LaunchStatus } from "./schema";

export async function getLaunchSnapshot(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<LaunchSnapshot> {
  const menus = await db
    .select({ id: menu.id, doc: menu.doc })
    .from(menu)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, menu.restaurantId))
    .where(
      and(eq(restaurantMembership.userId, userId), eq(menu.restaurantId, restaurantId))
    );

  const publications = await db
    .select({
      restaurantId: publishedMenu.restaurantId,
      publishedAt: publishedMenu.publishedAt,
    })
    .from(publishedMenu)
    .innerJoin(
      restaurantMembership,
      eq(restaurantMembership.restaurantId, publishedMenu.restaurantId)
    )
    .where(
      and(
        eq(restaurantMembership.userId, userId),
        eq(publishedMenu.restaurantId, restaurantId),
        isNotNull(publishedMenu.publishedAt)
      )
    )
    .orderBy(desc(publishedMenu.publishedAt));

  const orders = await db
    .select({ value: count() })
    .from(order)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, order.restaurantId))
    .where(and(eq(restaurantMembership.userId, userId), eq(order.restaurantId, restaurantId)));

  let unpricedItems = 0;
  let reviewNotes = 0;
  let unreadableMenus = 0;
  for (const row of menus) {
    const parsed = menuDocumentSchema.safeParse(row.doc);
    if (!parsed.success) {
      unreadableMenus += 1;
      continue;
    }
    for (const category of parsed.data.categories) {
      for (const item of category.items) {
        if (!hasAnyPrice(item) && !item.unpricedAccepted) unpricedItems += 1;
        if (item.reviewNotes.length > 0) reviewNotes += 1;
      }
    }
  }

  return {
    menuCount: menus.length,
    publishedCount: publications.length,
    orderCount: Number(orders[0]?.value ?? 0),
    unpricedItems,
    reviewNotes,
    unreadableMenus,
  };
}

/**
 * One café's checklist plus the account's two spend halves — the composition
 * every launch surface serves, so the café-in-path and café-in-query routes
 * cannot drift.
 *
 * The counts belong to the café; the allowances belong to the account. That
 * split is why spend has its own account-level route
 * (`/api/account/usage`) and why a staff membership never reads this payload.
 */
export async function readLaunchStatus(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<LaunchStatus> {
  const [snapshot, usage, assistant] = await Promise.all([
    getLaunchSnapshot(db, userId, restaurantId),
    getMonthlyUsageSummary(db, userId),
    getAssistantSpendSummary(db, userId),
  ]);
  return { ...snapshot, usage, assistant };
}
