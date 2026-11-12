/**
 * The one membership the shell acts in.
 *
 * One sign-in can hold an owner café and a staff café at once — the same
 * person who runs their own place may also work someone else's shift. Their
 * capabilities must not be a union: an owner control must never appear while
 * the person is acting as staff, and a staff-only surface must not hide
 * behind the other café's grant. So the shell picks one membership at a time
 * and asks only that one.
 *
 * Pure and client-safe. The server still resolves each membership's
 * capabilities; this module only chooses among the memberships it was sent.
 * The choice is a small device preference, stored per account (localStorage
 * is for tiny prefs only), so it never travels to another sign-in.
 */

import type { MembershipAccess } from "@/features/menus/sync";
import { restaurantCapabilities } from "./access";
import { hasCapability, type Capability } from "./permissions";

/** A restaurant row as the shell receives it: identity, role, capabilities. */
export interface WorkspaceRestaurant {
  id: string;
  name: string;
  role: "owner" | "staff";
  /** The server's capability answer, when this payload carried one. */
  access?: MembershipAccess;
}

/** One membership, ready to act in. */
export interface Workspace {
  /**
   * Stable identity of the membership. The restaurant id alone, so a later
   * promotion or demotion keeps the person where they already were instead
   * of silently moving them to the list's first café.
   */
  key: string;
  restaurantId: string;
  name: string;
  role: "owner" | "staff";
  capabilities: Capability[];
}

/** Resolve each membership's capabilities, keeping the server's answer. */
export function workspaceList(restaurants: readonly WorkspaceRestaurant[]): Workspace[] {
  return restaurants.map((restaurant) => ({
    key: restaurant.id,
    restaurantId: restaurant.id,
    name: restaurant.name,
    role: restaurant.role,
    capabilities: restaurantCapabilities(restaurant),
  }));
}

/**
 * The membership to act in: the remembered one while it still exists, else
 * the café the account owns (it has the most to lose from landing in the
 * wrong context), else the first membership in list order.
 */
export function resolveActiveWorkspace(
  workspaces: readonly Workspace[],
  storedKey: string | null
): Workspace | null {
  if (workspaces.length === 0) return null;
  const stored = storedKey
    ? workspaces.find((workspace) => workspace.key === storedKey)
    : undefined;
  return (
    stored ?? workspaces.find((workspace) => workspace.role === "owner") ?? workspaces[0] ?? null
  );
}

/** The one permission question for a chosen membership. */
export function workspaceCan(workspace: Workspace | null, capability: Capability): boolean {
  return workspace !== null && hasCapability(workspace.capabilities, capability);
}

/** How the switcher names one membership: "Joe's — Owner". */
export function workspaceLabel(workspace: Pick<Workspace, "name" | "role">): string {
  return `${workspace.name} — ${workspace.role === "owner" ? "Owner" : "Staff"}`;
}

/** The tiny slice of storage this module needs (a real Storage, or a stub). */
export type WorkspaceStore = Pick<Storage, "getItem" | "setItem">;

/** The browser's localStorage, or null where it is unavailable (SSR, private). */
export function browserStorage(): WorkspaceStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Per account: a staff context on a shared device must not follow the next person. */
export function workspaceStorageKey(accountId: string): string {
  return `eateryo.workspace.${accountId}`;
}

/** The account's remembered membership, or null when it has none. */
export function readStoredWorkspaceKey(
  store: WorkspaceStore | null,
  accountId: string
): string | null {
  if (!store) return null;
  try {
    const value = store.getItem(workspaceStorageKey(accountId));
    return value && value.trim() ? value : null;
  } catch {
    // A blocked store is no choice, not an error: the default still applies.
    return null;
  }
}

/** Remember the choice. Failure only costs the preference, never the switch. */
export function writeStoredWorkspaceKey(
  store: WorkspaceStore | null,
  accountId: string,
  key: string
): void {
  if (!store) return;
  try {
    store.setItem(workspaceStorageKey(accountId), key);
  } catch {
    // Private mode / quota: the current choice still applies this session.
  }
}
