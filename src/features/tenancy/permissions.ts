import type { RestaurantRole } from "@/lib/db/schema";

/**
 * One capability vocabulary for restaurant access.
 *
 * The `owner | staff` role stays the ownership axis (who may delete the
 * café, who is the last owner), while capabilities decide what a member may
 * actually do. Client-safe and pure: no Drizzle, no HTTP. Server repos and
 * browser surfaces both read the same list, so a control can never be shown
 * for a write the repository would refuse.
 *
 * `menus.read` covers the published snapshot only; `menus.read_draft` is the
 * extra grant that exposes the working document.
 */
export const CAPABILITIES = [
  "orders.read",
  "orders.update",
  "menus.read",
  "menus.read_draft",
  "menus.write",
  "menus.publish",
  "tables.print",
  "tables.link",
  "team.read",
  "team.manage",
  "settings.read",
  "settings.manage",
  "assistant.use",
  "account.export",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_SET = new Set<string>(CAPABILITIES);

export function isCapability(value: string): value is Capability {
  return CAPABILITY_SET.has(value);
}

/**
 * What a plain `staff` membership can do: read the menus that are actually
 * published, take and advance orders, print table links, and read the team
 * and settings. Draft access is an explicit grant (`menus.read_draft`), so
 * unpublished prices and notes never reach a staff account by default.
 * It never includes a write.
 */
export const STAFF_CAPABILITIES: readonly Capability[] = [
  "orders.read",
  "orders.update",
  "menus.read",
  "tables.print",
  "team.read",
  "settings.read",
  "assistant.use",
];

/**
 * Named capability sets the invite UI can offer. They are stored as the
 * member's explicit array, so a later change to one default never silently
 * rewrites what an existing member was granted.
 */
export const PERMISSION_PRESETS = {
  "orders-only": ["orders.read", "orders.update", "tables.print"],
  "menu-editor": [
    "orders.read",
    "menus.read",
    "menus.read_draft",
    "menus.write",
    "tables.print",
    "assistant.use",
  ],
  manager: [
    "orders.read",
    "orders.update",
    "menus.read",
    "menus.read_draft",
    "menus.write",
    "menus.publish",
    "tables.print",
    "tables.link",
    "team.read",
    "settings.read",
    "assistant.use",
  ],
  owner: CAPABILITIES,
} as const satisfies Record<string, readonly Capability[]>;

export type PermissionPreset = keyof typeof PERMISSION_PRESETS;

/** Stable, de-duplicated capability list (vocabulary order, not input order). */
export function orderCapabilities(values: Iterable<Capability>): Capability[] {
  const wanted = new Set(values);
  return CAPABILITIES.filter((capability) => wanted.has(capability));
}

/**
 * Resolve a membership to its capabilities.
 *
 * An empty override array means "the role's defaults" — so existing rows
 * need no backfill. A non-empty array is the member's full staff grant,
 * replacing the staff defaults; unknown strings are ignored rather than
 * trusted. Owners always hold everything: the café must never be left with
 * no one able to manage it, whatever a stale override row says.
 */
export function capabilitiesForMembership(
  role: RestaurantRole,
  overrides: readonly string[] | null | undefined
): Capability[] {
  if (role === "owner") return [...CAPABILITIES];
  if (!overrides || overrides.length === 0) return [...STAFF_CAPABILITIES];
  return orderCapabilities(overrides.filter(isCapability));
}

/** The single question every gate asks. */
export function hasCapability(
  capabilities: readonly Capability[],
  capability: Capability
): boolean {
  return capabilities.includes(capability);
}
