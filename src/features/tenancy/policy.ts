import { and, eq } from "drizzle-orm";

import { restaurantMembership } from "@/lib/db/schema";
import type { RestaurantRole } from "@/lib/db/schema";
import type { TenancyDb } from "./repo";
import {
  capabilitiesForMembership,
  hasCapability,
  type Capability,
} from "./permissions";

/**
 * Server-side policy: resolve a membership to the one access answer every
 * repository gate asks for.
 *
 * The role still names ownership (last-owner guards, café deletion), but
 * permission checks go through `can`. One module instead of a hand-written
 * `role === "owner"` in each repo means a new surface cannot quietly invent
 * its own rule, and the browser can receive the same answer with its menus.
 */

export interface MembershipAccess {
  role: RestaurantRole;
  capabilities: Capability[];
}

/** Turn a membership row (role + stored overrides) into its capabilities. */
export function accessFromMembership(row: {
  role: RestaurantRole;
  permissions: readonly string[] | null;
}): MembershipAccess {
  return {
    role: row.role,
    capabilities: capabilitiesForMembership(row.role, row.permissions),
  };
}

/** The caller's access to one restaurant, or null if they are not a member. */
export async function getMembershipAccess(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<MembershipAccess | null> {
  const rows = await db
    .select({
      role: restaurantMembership.role,
      permissions: restaurantMembership.permissions,
    })
    .from(restaurantMembership)
    .where(
      and(
        eq(restaurantMembership.userId, userId),
        eq(restaurantMembership.restaurantId, restaurantId)
      )
    )
    .limit(1);
  const row = rows[0];
  return row ? accessFromMembership(row) : null;
}

/** The one permission question. A missing membership can do nothing. */
export function can(
  access: MembershipAccess | null,
  capability: Capability
): access is MembershipAccess {
  return access !== null && hasCapability(access.capabilities, capability);
}
