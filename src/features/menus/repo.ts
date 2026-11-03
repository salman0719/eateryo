import { and, asc, desc, eq } from "drizzle-orm";

import {
  menu,
  menuRevision,
  publishedMenu,
  restaurant,
  restaurantMembership,
} from "@/lib/db/schema";
import type { RestaurantRole } from "@/lib/db/schema";
import type { TenancyDb } from "@/features/tenancy/repo";
import {
  accessFromMembership,
  can,
  getMembershipAccess,
  type MembershipAccess,
} from "@/features/tenancy/policy";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { hasCapability } from "@/features/tenancy/permissions";
import { menuAvailabilitySchema, type MenuAvailability } from "@/features/availability/schema";

/**
 * Server repository for menu documents (Step 8 — server-backed menus).
 *
 * Tenancy rules (PHASE-2.md §3.1), enforced here and nowhere else:
 * - Reads require a membership with menu access. A member without
 *   `menus.read_draft` receives the live published revision only: a menu
 *   that has never been published is invisible, and a draft edit never
 *   changes what they read. Orders-only staff get no menus at all.
 * - Mutations (create/update/delete) require `menus.write`, matching the
 *   restaurants repo's owner-only default; staff can never write unless a
 *   preset explicitly grants it.
 * - The userId always comes from the verified session, never from a client
 *   payload. A menu in a restaurant the caller doesn't belong to is
 *   reported as `not_found` — never `forbidden` — so ids of other tenants
 *   cannot be probed.
 *
 * Conflict detection: `updateMenuForUser` only writes when the row's
 * `updated_at` still equals the caller's `expectedUpdatedAt` (a conditional
 * UPDATE, not a read-then-write — the Neon HTTP driver has no interactive
 * transactions). A mismatch throws `stale_menu` carrying the current server
 * `updatedAt`, so two editing browsers converge through an explicit reload
 * instead of silently overwriting each other.
 *
 * Every direction crosses the canonical Zod schema: documents are validated
 * on write and re-validated on read, so a malformed row fails loudly rather
 * than rendering garbage (AGENTS.md — one canonical menu schema).
 */

export type MenuRepoErrorCode = "not_found" | "forbidden" | "stale" | "exists" | "invalid_doc";

export class MenuRepoError extends Error {
  readonly code: MenuRepoErrorCode;
  /** For `stale`: the row's current server updatedAt (ISO 8601). */
  readonly currentUpdatedAt: string | null;

  constructor(code: MenuRepoErrorCode, message: string, currentUpdatedAt: string | null = null) {
    super(message);
    this.name = "MenuRepoError";
    this.code = code;
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

export interface ServerMenuSummary {
  id: string;
  restaurantId: string;
  restaurantName: string;
  title: string;
  currency: string | null;
  /** Opening windows (empty = always open); edited without republishing. */
  availability: MenuAvailability;
  createdAt: string;
  updatedAt: string;
  /**
   * The caller's capabilities on this menu's restaurant, resolved from the
   * same membership row the query already joined. Returning it with the menu
   * means the browser never needs a second read to know whether it may show
   * an edit control.
   */
  access: MembershipAccess;
}

export interface ServerMenu extends ServerMenuSummary {
  doc: MenuDocument;
}

/** One joined row: the menu plus the caller's membership role on its restaurant. */
type MenuWithRole = {
  id: string;
  restaurantId: string;
  restaurantName: string;
  title: string;
  currency: string | null;
  availability: unknown;
  doc: unknown;
  createdAt: Date;
  updatedAt: Date;
  role: RestaurantRole;
  permissions: string[] | null;
  /** The live revision's document, null when the menu is not published. */
  liveDoc: unknown | null;
  livePublishedAt: Date | null;
  liveRevisionAt: Date | null;
};

const menuJoin = (db: TenancyDb) =>
  db
    .select({
      id: menu.id,
      restaurantId: menu.restaurantId,
      restaurantName: restaurant.name,
      title: menu.title,
      currency: menu.currency,
      availability: menu.availability,
      doc: menu.doc,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
      role: restaurantMembership.role,
      permissions: restaurantMembership.permissions,
      liveDoc: menuRevision.doc,
      livePublishedAt: publishedMenu.publishedAt,
      liveRevisionAt: menuRevision.createdAt,
    })
    .from(menu)
    .innerJoin(restaurant, eq(menu.restaurantId, restaurant.id))
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, restaurant.id))
    // One live pointer per menu, and one revision per pointer: these joins
    // never multiply rows. Unpublished menus simply have no live row.
    .leftJoin(publishedMenu, eq(publishedMenu.menuId, menu.id))
    .leftJoin(menuRevision, eq(menuRevision.id, publishedMenu.liveRevisionId));

function iso(value: Date): string {
  return value.toISOString();
}

function toSummary(
  row: Omit<MenuWithRole, "doc">,
  access: MembershipAccess,
  live?: { doc: MenuDocument; updatedAt: Date }
): ServerMenuSummary {
  const availability = menuAvailabilitySchema.safeParse(row.availability);
  if (!availability.success) {
    throw new Error(`stored menu ${row.id} has invalid availability`);
  }
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    restaurantName: row.restaurantName,
    // A projected reader sees the live snapshot's title and currency, not a
    // draft that has not been published yet.
    title: live?.doc.title ?? row.title,
    currency: live?.doc.currency ?? row.currency,
    availability: availability.data,
    createdAt: iso(row.createdAt),
    updatedAt: iso(live?.updatedAt ?? row.updatedAt),
    access,
  };
}

function parseStoredDoc(menuId: string, doc: unknown): MenuDocument {
  const parsed = menuDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    // Honest failure: a stored row that no longer matches the canonical
    // schema is a server bug, not something to silently repair.
    throw new Error(`stored menu ${menuId} failed canonical schema validation`);
  }
  return parsed.data;
}

function toMenu(row: MenuWithRole): ServerMenu {
  return { ...toSummary(row, accessFromMembership(row)), doc: parseStoredDoc(row.id, row.doc) };
}

/** A member may read menus at all (published, draft, or write implies read). */
function canReadMenus(access: MembershipAccess): boolean {
  return (
    hasCapability(access.capabilities, "menus.read") ||
    hasCapability(access.capabilities, "menus.read_draft") ||
    hasCapability(access.capabilities, "menus.write")
  );
}

/** Seeing the working document is the explicit draft grant (or write). */
function canSeeDraft(access: MembershipAccess): boolean {
  return (
    hasCapability(access.capabilities, "menus.read_draft") ||
    hasCapability(access.capabilities, "menus.write")
  );
}

/** The live snapshot, if this menu is currently published. */
function liveProjection(row: MenuWithRole): { doc: MenuDocument; updatedAt: Date } | null {
  if (row.livePublishedAt === null || row.liveDoc === null) return null;
  return {
    doc: parseStoredDoc(row.id, row.liveDoc),
    updatedAt: row.liveRevisionAt ?? row.livePublishedAt,
  };
}

/**
 * The menu this caller is allowed to read, or null when it is invisible to
 * them. This is the one place the draft/live decision is made; the list and
 * single-menu paths both use it, so they cannot disagree.
 */
function projectMenu(row: MenuWithRole): { menu: ServerMenu; access: MembershipAccess } | null {
  const access = accessFromMembership(row);
  if (!canReadMenus(access)) return null;
  if (canSeeDraft(access)) return { menu: toMenu(row), access };
  const live = liveProjection(row);
  if (!live) return null;
  return { menu: { ...toSummary(row, access, live), doc: live.doc }, access };
}

/** Validate + stamp a document for persistence. Server clock owns updatedAt. */
function prepareDoc(input: MenuDocument): { doc: MenuDocument; updatedAt: Date } {
  const parsed = menuDocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw new MenuRepoError(
      "invalid_doc",
      parsed.error.issues[0]?.message ?? "The menu document is not valid."
    );
  }
  const updatedAt = new Date();
  return { doc: { ...parsed.data, updatedAt: iso(updatedAt) }, updatedAt };
}

function stampRowValues(doc: MenuDocument, updatedAt: Date) {
  return { title: doc.title, currency: doc.currency, doc, updatedAt };
}

/**
 * Menus across the caller's restaurants, most recent first.
 *
 * Owners and explicit draft readers see every menu and its draft values;
 * a published-only reader sees just live menus, projected from the snapshot;
 * orders-only staff see none. The list is filtered here — not hidden in the
 * browser — so an unpublished menu never reaches the client at all.
 */
export async function listMenusForUser(
  db: TenancyDb,
  userId: string
): Promise<ServerMenuSummary[]> {
  const rows = await menuJoin(db)
    .where(eq(restaurantMembership.userId, userId))
    .orderBy(desc(menu.updatedAt), asc(menu.id));
  const visible: ServerMenuSummary[] = [];
  for (const row of rows) {
    const access = accessFromMembership(row);
    if (!canReadMenus(access)) continue;
    if (canSeeDraft(access)) {
      visible.push(toSummary(row, access));
      continue;
    }
    const live = liveProjection(row);
    if (live) visible.push(toSummary(row, access, live));
  }
  return visible.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
  );
}

/**
 * Create a menu (with its client-generated id, preserved for account
 * import) inside a restaurant the caller owns.
 */
export async function createMenuForUser(
  db: TenancyDb,
  userId: string,
  restaurantId: string,
  input: MenuDocument
): Promise<ServerMenu> {
  const access = await getMembershipAccess(db, userId, restaurantId);
  if (!access) {
    // No membership: the restaurant must not be distinguishable from a
    // nonexistent one.
    throw new MenuRepoError("not_found", "That restaurant does not exist.");
  }
  if (!can(access, "menus.write")) {
    throw new MenuRepoError("forbidden", "Only the restaurant owner can add menus.");
  }
  const { doc, updatedAt } = prepareDoc(input);
  if (doc.id !== input.id) {
    throw new MenuRepoError("invalid_doc", "Menu id mismatch.");
  }
  try {
    await db.insert(menu).values({
      id: doc.id,
      restaurantId,
      ...stampRowValues(doc, updatedAt),
      // New menus open always until the owner configures windows.
      availability: [],
      createdAt: updatedAt,
    });
  } catch (error) {
    if (await menuExists(db, doc.id)) {
      throw new MenuRepoError("exists", "A menu with this id already exists in your account.");
    }
    throw error;
  }
  const created = await menuJoin(db).where(
    and(eq(menu.id, doc.id), eq(restaurantMembership.userId, userId))
  );
  const row = created[0];
  if (!row) throw new Error("menu creation did not produce a readable row");
  return toMenu(row);
}

/**
 * One menu as this caller may read it: the draft for draft readers, the live
 * snapshot for published-only readers, and `not_found` for everyone else
 * (including orders-only staff and a menu that was never published).
 */
export async function getMenuForUser(
  db: TenancyDb,
  userId: string,
  menuId: string
): Promise<ServerMenu> {
  return (await getMenuWithRoleForUser(db, userId, menuId)).menu;
}

/**
 * The projected menu plus the caller's access. The assistant needs the
 * capabilities to decide whether a proposal is allowed at all; a projected
 * reader can never write, so the proposal path stays closed to them.
 */
export async function getMenuWithRoleForUser(
  db: TenancyDb,
  userId: string,
  menuId: string
): Promise<{ menu: ServerMenu; access: MembershipAccess }> {
  const rows = await menuJoin(db).where(
    and(eq(menu.id, menuId), eq(restaurantMembership.userId, userId))
  );
  const row = rows[0];
  const projected = row ? projectMenu(row) : null;
  if (!projected) throw new MenuRepoError("not_found", "That menu does not exist.");
  return projected;
}

/**
 * Replace a menu's document, but only if it has not changed on the server
 * since the caller last read it. `expectedUpdatedAt` must be an ISO string
 * previously returned by this API; anything else is a client bug and is
 * rejected as `invalid_doc`.
 */
export async function updateMenuForUser(
  db: TenancyDb,
  userId: string,
  menuId: string,
  input: MenuDocument,
  expectedUpdatedAt: string
): Promise<ServerMenu> {
  const rows = await menuJoin(db).where(
    and(eq(menu.id, menuId), eq(restaurantMembership.userId, userId))
  );
  const existing = rows[0];
  if (!existing) throw new MenuRepoError("not_found", "That menu does not exist.");
  if (!can(accessFromMembership(existing), "menus.write")) {
    throw new MenuRepoError("forbidden", "Only the restaurant owner can change menus.");
  }

  const expected = new Date(expectedUpdatedAt);
  if (Number.isNaN(expected.getTime())) {
    throw new MenuRepoError("invalid_doc", "expectedUpdatedAt must be an ISO 8601 timestamp.");
  }
  if (input.id !== menuId) {
    throw new MenuRepoError("invalid_doc", "Menu id mismatch.");
  }
  const { doc, updatedAt } = prepareDoc(input);

  // The conflict check and the write are one statement: no transaction is
  // needed even on the Neon HTTP driver, and a concurrent write between
  // our read and this UPDATE simply loses the race (0 rows) instead of
  // being overwritten.
  const updated = await db
    .update(menu)
    .set(stampRowValues(doc, updatedAt))
    .where(and(eq(menu.id, menuId), eq(menu.updatedAt, expected)))
    .returning({ id: menu.id });

  if (updated.length === 0) {
    const current = await db
      .select({ updatedAt: menu.updatedAt })
      .from(menu)
      .where(eq(menu.id, menuId));
    const row = current[0];
    if (!row) throw new MenuRepoError("not_found", "That menu does not exist.");
    throw new MenuRepoError(
      "stale",
      "This menu was changed elsewhere since you last loaded it.",
      iso(row.updatedAt)
    );
  }

  const fresh = await menuJoin(db).where(
    and(eq(menu.id, menuId), eq(restaurantMembership.userId, userId))
  );
  const freshRow = fresh[0];
  if (!freshRow) throw new Error("menu update did not produce a readable row");
  return toMenu(freshRow);
}

/** Owner-only delete. False when the menu doesn't exist (or isn't the caller's). */
export async function deleteMenuForUser(
  db: TenancyDb,
  userId: string,
  menuId: string
): Promise<boolean> {
  const rows = await menuJoin(db).where(
    and(eq(menu.id, menuId), eq(restaurantMembership.userId, userId))
  );
  const existing = rows[0];
  if (!existing) return false;
  if (!can(accessFromMembership(existing), "menus.write")) {
    throw new MenuRepoError("forbidden", "Only the restaurant owner can delete menus.");
  }
  const deleted = await db.delete(menu).where(eq(menu.id, menuId)).returning({ id: menu.id });
  return deleted.length > 0;
}

async function menuExists(db: TenancyDb, menuId: string): Promise<boolean> {
  const rows = await db.select({ id: menu.id }).from(menu).where(eq(menu.id, menuId));
  return rows.length > 0;
}
