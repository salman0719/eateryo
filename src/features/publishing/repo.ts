import { and, eq, isNotNull } from "drizzle-orm";

import {
  menu,
  menuRevision,
  publishedMenu,
  restaurant,
  restaurantMembership,
} from "@/lib/db/schema";
import type { RestaurantRole } from "@/lib/db/schema";
import type { TenancyDb } from "@/features/tenancy/repo";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { ensureRestaurantSlug } from "@/features/tables/repo";

import { publishBodySchema, type PublicationStatus } from "./schema";
import { slugCandidates, slugifyMenuTitle } from "./slug";

/**
 * Server repository for published menus (Step 9 — one-click publish).
 *
 * Publishing is not a page builder. It snapshots the menu into a revision so
 * table ordering can price what a diner saw, and points the live pointer at
 * that snapshot. Diners reach a menu through a table card
 * (`/r/<restaurant>/t/<table>`), never through a browsable page: there is no
 * public menu URL, no theme, and no view counter here.
 *
 * Tenancy and roles mirror the menu repo exactly (PHASE-2.md §3.1): any
 * member may read a menu's publication status, only the owner may publish or
 * unpublish. A menu that isn't the caller's is reported as `not_found`,
 * never `forbidden`, so ids cannot be probed.
 *
 * The live menu is always a stored snapshot: editing the menu afterwards
 * cannot change what a diner's order is priced against, and
 * `hasUnpublishedChanges` is a timestamp comparison — the live revision's
 * `sourceUpdatedAt` against the menu row's `updated_at` — not a re-diff of
 * two documents.
 *
 * A reserved slug is kept with the row so a menu's own order address stays
 * stable across unpublish/republish. Unpublishing clears `published_at` and
 * the live pointer, which takes the menu out of table ordering; nothing here
 * deletes history.
 */

export type PublicationRepoErrorCode =
  | "not_found"
  | "forbidden"
  | "invalid"
  | "slug_taken"
  | "not_published";

export class PublicationRepoError extends Error {
  readonly code: PublicationRepoErrorCode;

  constructor(code: PublicationRepoErrorCode, message: string) {
    super(message);
    this.name = "PublicationRepoError";
    this.code = code;
  }
}

export interface PublishInput {
  /** Omit to keep the current slug (or derive one from the title). */
  slug?: string;
}

/** A live menu, prepared for the order route. */
export interface PublishedMenuPage {
  slug: string;
  /** The restaurant's `/r/<slug>` address — part of the order path. */
  restaurantSlug: string;
  /** The menu and tenant this snapshot belongs to (orders are scoped by them). */
  menuId: string;
  restaurantId: string;
  restaurantName: string;
  doc: MenuDocument;
  publishedAt: string;
}

interface MenuWithRole {
  id: string;
  restaurantId: string;
  doc: unknown;
  updatedAt: Date;
  role: RestaurantRole;
}

async function loadMenuWithRole(
  db: TenancyDb,
  userId: string,
  menuId: string
): Promise<MenuWithRole | null> {
  const rows = await db
    .select({
      id: menu.id,
      restaurantId: menu.restaurantId,
      doc: menu.doc,
      updatedAt: menu.updatedAt,
      role: restaurantMembership.role,
    })
    .from(menu)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, menu.restaurantId))
    .where(and(eq(menu.id, menuId), eq(restaurantMembership.userId, userId)));
  return rows[0] ?? null;
}

/**
 * Read a menu's publication state without a user scope. Callers must have
 * already established membership (the exported functions below do).
 */
async function readStatus(db: TenancyDb, menuId: string): Promise<PublicationStatus | null> {
  const rows = await db
    .select({
      publishedAt: publishedMenu.publishedAt,
      liveRevisionId: publishedMenu.liveRevisionId,
      restaurantId: publishedMenu.restaurantId,
      menuUpdatedAt: menu.updatedAt,
      sourceUpdatedAt: menuRevision.sourceUpdatedAt,
    })
    .from(publishedMenu)
    .innerJoin(menu, eq(menu.id, publishedMenu.menuId))
    .leftJoin(menuRevision, eq(menuRevision.id, publishedMenu.liveRevisionId))
    .where(eq(publishedMenu.menuId, menuId));

  const row = rows[0];
  if (!row) return null;

  const isLive = row.publishedAt !== null && row.liveRevisionId !== null;
  const sourceUpdatedAt = isLive && row.sourceUpdatedAt ? row.sourceUpdatedAt : null;
  return {
    menuId,
    restaurantId: row.restaurantId,
    isLive,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    liveRevisionId: isLive ? row.liveRevisionId : null,
    sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
    // Only meaningful while live: a reserved-but-unpublished menu has
    // nothing serving to be out of date with.
    hasUnpublishedChanges:
      sourceUpdatedAt !== null && sourceUpdatedAt.getTime() !== row.menuUpdatedAt.getTime(),
  };
}

/** Any member can read the publication status; null = never published. */
export async function getPublicationStatus(
  db: TenancyDb,
  userId: string,
  menuId: string
): Promise<PublicationStatus | null> {
  const menuRow = await loadMenuWithRole(db, userId, menuId);
  if (!menuRow) throw new PublicationRepoError("not_found", "That menu does not exist.");
  return readStatus(db, menuId);
}

/** True when the slug already belongs to a different menu of this restaurant. */
async function slugTakenByAnother(
  db: TenancyDb,
  restaurantId: string,
  slug: string,
  menuId: string
): Promise<boolean> {
  const rows = await db
    .select({ menuId: publishedMenu.menuId })
    .from(publishedMenu)
    .where(and(eq(publishedMenu.restaurantId, restaurantId), eq(publishedMenu.slug, slug)));
  return rows.some((row) => row.menuId !== menuId);
}

/** Postgres unique-violation detection (Neon and PGlite both report 23505). */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (candidate.code === "23505") return true;
  if (typeof candidate.message === "string" && /duplicate key|unique constraint/i.test(candidate.message)) {
    return true;
  }
  return candidate.cause !== error && isUniqueViolation(candidate.cause);
}

/**
 * Reserve a new publication row, deriving a free slug from `base` **inside
 * this restaurant**. Races are resolved by retrying the next candidate on a
 * unique violation instead of failing the publish.
 */
async function reservePublication(
  db: TenancyDb,
  menuId: string,
  restaurantId: string,
  base: string
): Promise<{ id: string; slug: string }> {
  for (const candidate of slugCandidates(base)) {
    try {
      const inserted = await db
        .insert(publishedMenu)
        .values({ menuId, restaurantId, slug: candidate })
        .returning({ id: publishedMenu.id, slug: publishedMenu.slug });
      return inserted[0];
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }
  throw new PublicationRepoError(
    "slug_taken",
    "Could not find a free address for this menu. Try a different name."
  );
}

async function changeSlug(
  db: TenancyDb,
  restaurantId: string,
  menuId: string,
  slug: string
): Promise<void> {
  if (await slugTakenByAnother(db, restaurantId, slug, menuId)) {
    throw new PublicationRepoError(
      "slug_taken",
      "That address is already used by another menu at this restaurant."
    );
  }
  try {
    await db.update(publishedMenu).set({ slug }).where(eq(publishedMenu.menuId, menuId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PublicationRepoError("slug_taken", "That address was just taken. Try another.");
    }
    throw error;
  }
}

/**
 * Publish the menu's current document (or publish changes): store a new
 * revision snapshot, then point the live pointer at it. Re-publishing keeps
 * the existing slug. There is no style input — a menu has one diner surface
 * (the order page), so nothing about its appearance is snapshotted.
 */
export async function publishMenuForUser(
  db: TenancyDb,
  userId: string,
  menuId: string,
  input: PublishInput = {}
): Promise<PublicationStatus> {
  const menuRow = await loadMenuWithRole(db, userId, menuId);
  if (!menuRow) throw new PublicationRepoError("not_found", "That menu does not exist.");
  if (menuRow.role !== "owner") {
    throw new PublicationRepoError("forbidden", "Only the restaurant owner can publish this menu.");
  }

  const body = publishBodySchema.safeParse(input);
  if (!body.success) {
    throw new PublicationRepoError(
      "invalid",
      body.error.issues[0]?.message ?? "The publish request is not valid."
    );
  }
  const parsedDoc = menuDocumentSchema.safeParse(menuRow.doc);
  if (!parsedDoc.success) {
    // A stored row that no longer matches the canonical schema is a server
    // bug — refusing beats publishing garbage.
    throw new PublicationRepoError("invalid", "This menu is not valid and cannot be published.");
  }

  // Resolve the address before touching the live pointer.
  const existing = await db
    .select({ id: publishedMenu.id, slug: publishedMenu.slug })
    .from(publishedMenu)
    .where(eq(publishedMenu.menuId, menuId));
  let publication = existing[0];
  if (!publication) {
    if (body.data.slug) {
      if (await slugTakenByAnother(db, menuRow.restaurantId, body.data.slug, menuId)) {
        throw new PublicationRepoError(
          "slug_taken",
          "That address is already used by another menu at this restaurant."
        );
      }
      publication = await reservePublication(db, menuId, menuRow.restaurantId, body.data.slug);
    } else {
      publication = await reservePublication(
        db,
        menuId,
        menuRow.restaurantId,
        slugifyMenuTitle(parsedDoc.data.title)
      );
    }
  } else if (body.data.slug && body.data.slug !== publication.slug) {
    await changeSlug(db, menuRow.restaurantId, menuId, body.data.slug);
  }

  const revisionId = crypto.randomUUID();
  await db.insert(menuRevision).values({
    id: revisionId,
    menuId,
    restaurantId: menuRow.restaurantId,
    doc: parsedDoc.data,
    sourceUpdatedAt: menuRow.updatedAt,
  });

  // Move the live pointer only after the snapshot exists, so a failure never
  // leaves table ordering pointing at a missing revision.
  const now = new Date();
  await db
    .update(publishedMenu)
    .set({ liveRevisionId: revisionId, publishedAt: now, updatedAt: now })
    .where(eq(publishedMenu.id, publication.id));

  // A live menu must be resolvable by its café's `/r/` address: that is how
  // the diner read path finds the snapshot. A café that publishes before it
  // ever opens the Tables tab would otherwise have no slug at all, and its
  // live menu would be unreachable until something else claimed one. The
  // claim is idempotent and derived from the café's own name.
  await ensureRestaurantSlug(db, menuRow.restaurantId);

  const status = await readStatus(db, menuId);
  if (!status) throw new Error("publishing did not produce a readable publication row");
  return status;
}

/** Take the menu out of table ordering; the slug stays reserved for it. */
export async function unpublishMenuForUser(
  db: TenancyDb,
  userId: string,
  menuId: string
): Promise<PublicationStatus> {
  const menuRow = await loadMenuWithRole(db, userId, menuId);
  if (!menuRow) throw new PublicationRepoError("not_found", "That menu does not exist.");
  if (menuRow.role !== "owner") {
    throw new PublicationRepoError("forbidden", "Only the restaurant owner can unpublish this menu.");
  }
  const existing = await db
    .select({ id: publishedMenu.id })
    .from(publishedMenu)
    .where(eq(publishedMenu.menuId, menuId));
  if (existing.length === 0) {
    throw new PublicationRepoError("not_published", "This menu has not been published.");
  }
  await db
    .update(publishedMenu)
    .set({ publishedAt: null, liveRevisionId: null, updatedAt: new Date() })
    .where(eq(publishedMenu.menuId, menuId));

  const status = await readStatus(db, menuId);
  if (!status) throw new Error("unpublishing did not produce a readable publication row");
  return status;
}

/**
 * The diner read path: a live menu by its address — the restaurant's
 * `/r/<slug>` plus the menu's own slug — with the snapshot's document
 * re-validated against the canonical schema. Null means "not found or not
 * serving" — callers must render a 404, never a partial page.
 */
export async function getPublishedMenuByPath(
  db: TenancyDb,
  restaurantSlug: string,
  slug: string
): Promise<PublishedMenuPage | null> {
  const rows = await db
    .select({
      slug: publishedMenu.slug,
      restaurantId: publishedMenu.restaurantId,
      menuId: publishedMenu.menuId,
      publishedAt: publishedMenu.publishedAt,
      restaurantName: restaurant.name,
      doc: menuRevision.doc,
    })
    .from(publishedMenu)
    .innerJoin(menu, eq(menu.id, publishedMenu.menuId))
    .innerJoin(menuRevision, eq(menuRevision.id, publishedMenu.liveRevisionId))
    .innerJoin(restaurant, eq(restaurant.id, publishedMenu.restaurantId))
    .where(
      and(
        eq(restaurant.slug, restaurantSlug),
        eq(publishedMenu.slug, slug),
        isNotNull(publishedMenu.publishedAt)
      )
    );

  const row = rows[0];
  if (!row || row.publishedAt === null) return null;

  const parsedDoc = menuDocumentSchema.safeParse(row.doc);
  if (!parsedDoc.success) {
    throw new Error(`published menu ${slug} failed canonical schema validation`);
  }

  return {
    slug: row.slug,
    restaurantSlug,
    menuId: row.menuId,
    restaurantId: row.restaurantId,
    restaurantName: row.restaurantName,
    doc: parsedDoc.data,
    publishedAt: row.publishedAt.toISOString(),
  };
}
