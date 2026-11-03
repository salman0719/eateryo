/**
 * Client-safe access decisions for menus. The server resolves a membership
 * into capabilities and ships that answer with every menu, so the browser
 * never derives a role from a second request (and never guesses while one is
 * in flight).
 *
 * `undefined` is the unanswered state, and it is not permission: caller
 * surfaces must wait rather than default to editable. `"local"` is a menu
 * that lives only in this browser, which the caller owns. `"none"` is a row
 * the account refused — its cached copy must stay unrendered.
 */

import type { MembershipAccess } from "@/features/menus/sync";
import {
  capabilitiesForMembership,
  hasCapability,
  type Capability,
} from "@/features/tenancy/permissions";

export type MenuAccess = MembershipAccess | "local" | "none";

/** Index the access each listed menu already carries. */
export function menuAccessById(
  menus: { id: string; access: MembershipAccess }[]
): Map<string, MembershipAccess> {
  return new Map(menus.map((menu) => [menu.id, menu.access]));
}

/** The one question every menu surface asks; unanswered and refused are false. */
export function accessCan(
  access: MenuAccess | undefined,
  capability: Capability
): boolean {
  if (access === "local") return true;
  if (access === undefined || access === "none") return false;
  return hasCapability(access.capabilities, capability);
}

/**
 * A restaurant's capabilities. The server sends `access`; a stubbed or older
 * payload without it falls back to the role's defaults, never to "allow".
 */
export function restaurantCapabilities(restaurant: {
  role: "owner" | "staff";
  access?: MembershipAccess;
}): Capability[] {
  return restaurant.access?.capabilities ?? capabilitiesForMembership(restaurant.role, null);
}

/** True when any restaurant on the account grants this capability. */
export function anyRestaurantCan(
  restaurants: readonly { role: "owner" | "staff"; access?: MembershipAccess }[],
  capability: Capability
): boolean {
  return restaurants.some((restaurant) =>
    hasCapability(restaurantCapabilities(restaurant), capability)
  );
}

/** True when the caller is on the restaurant as staff (their role axis). */
export function accessIsStaff(access: MenuAccess | undefined): boolean {
  return (
    access !== undefined &&
    access !== "local" &&
    access !== "none" &&
    access.role === "staff"
  );
}
