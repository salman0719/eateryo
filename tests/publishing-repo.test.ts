import { beforeEach, describe, expect, it } from "vitest";

import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import {
  getPublishedMenuByPath,
  getPublicationStatus,
  publishMenuForUser,
  PublicationRepoError,
  unpublishMenuForUser,
} from "@/features/publishing/repo";
import { createMenuForUser, getMenuForUser, updateMenuForUser } from "@/features/menus/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { menuRevision, publishedMenu, restaurantMembership } from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * Step 9 — publishing repository, against the real generated DDL on PGlite.
 *
 * Publishing is not a page builder: it snapshots the menu so table ordering
 * can price it. The acceptance properties pinned here:
 * - the live snapshot is frozen: editing the menu afterwards does not change
 *   what a diner's order is priced against, and the status honestly reports
 *   unpublished changes;
 * - publishing again updates the snapshot and reuses the reserved slug;
 * - unpublishing takes the menu out of ordering while keeping the slug;
 * - a menu's address is scoped to its café (`/r/<restaurant>/m/<menu>`);
 * - slugs are scoped to one restaurant (same title elsewhere = same slug,
 *   no suffix), with suffixes and refusals inside a single café;
 * - tenancy and roles: staff read only, outsiders see nothing and learn
 *   nothing.
 */
describe("publishing repo", () => {
  let db: TestDb;
  let ownerA: string;
  let ownerB: string;
  let restaurantA: string;
  let menuId: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    ownerA = await seedUser(db, "pub-owner-a@cafe.test", "Owner A");
    ownerB = await seedUser(db, "pub-owner-b@cafe.test", "Owner B");
    restaurantA = (await createRestaurant(db, ownerA, "Café A")).id;
    menuId = "menu-pub-1";
    await createMenuForUser(db, ownerA, restaurantA, sampleDoc(menuId, "Café A — Menu"));
  }, 30_000);

  function sampleDoc(id: string, title: string): MenuDocument {
    return menuDocumentSchema.parse({ ...createSampleMenuDocument(), id, title });
  }

  async function publish(slug?: string) {
    return publishMenuForUser(db, ownerA, menuId, slug ? { slug } : {});
  }

  it("publishes a snapshot that the diner read path serves", async () => {
    const stored = await getMenuForUser(db, ownerA, menuId);
    const status = await publish();
    expect(status.isLive).toBe(true);
    expect(status.hasUnpublishedChanges).toBe(false);

    const page = await getPublishedMenuByPath(db, "cafe-a", "cafe-a-menu");
    expect(page).not.toBeNull();
    expect(page!.restaurantName).toBe("Café A");
    expect(page!.doc.title).toBe("Café A — Menu");
    // Full fidelity: the snapshot is the canonical document, not a summary.
    expect(page!.doc.categories.map((c) => c.id)).toEqual(stored.doc.categories.map((c) => c.id));
    // The address is scoped: the same menu slug under another restaurant is
    // a different menu.
    expect(await getPublishedMenuByPath(db, "cafe-b", "cafe-a-menu")).toBeNull();
  });

  it("keeps the live snapshot frozen while the menu keeps being edited", async () => {
    await publish();
    const before = await getPublishedMenuByPath(db, "cafe-a", "cafe-a-menu");

    const current = await getMenuForUser(db, ownerA, menuId);
    const edited = { ...current.doc, title: "Renamed after publishing" };
    await updateMenuForUser(db, ownerA, menuId, edited, current.updatedAt);

    // Diner view is unchanged…
    const after = await getPublishedMenuByPath(db, "cafe-a", "cafe-a-menu");
    expect(after!.doc.title).toBe(before!.doc.title);
    // …and the owner is told there are unpublished changes.
    const status = await getPublicationStatus(db, ownerA, menuId);
    expect(status!.hasUnpublishedChanges).toBe(true);

    // Publishing changes snapshots the new document and clears the flag.
    const republished = await publish();
    expect(republished.hasUnpublishedChanges).toBe(false);
    expect((await getPublishedMenuByPath(db, "cafe-a", "cafe-a-menu"))!.doc.title).toBe(
      "Renamed after publishing"
    );

    // History is append-only: two revisions for one menu.
    const revisions = await db.select({ id: menuRevision.id }).from(menuRevision);
    expect(revisions).toHaveLength(2);
  });

  it("suffixes a derived slug on collision inside one restaurant instead of failing", async () => {
    await publish();
    const secondId = "menu-pub-2";
    await createMenuForUser(db, ownerA, restaurantA, sampleDoc(secondId, "Café A — Menu"));
    await publishMenuForUser(db, ownerA, secondId, {});
    // The derived address got a suffix rather than colliding or failing.
    expect(await getPublishedMenuByPath(db, "cafe-a", "cafe-a-menu-2")).not.toBeNull();
  });

  it("lets another restaurant publish the same slug — slugs are scoped, not global", async () => {
    await publish();
    const restaurantB = (await createRestaurant(db, ownerB, "Café B")).id;
    const otherId = "menu-pub-b1";
    await createMenuForUser(db, ownerB, restaurantB, sampleDoc(otherId, "Café A — Menu"));

    await publishMenuForUser(db, ownerB, otherId, {});
    // No "-2" suffix: the same title at another café is a different address.
    expect((await getPublishedMenuByPath(db, "cafe-b", "cafe-a-menu"))!.menuId).toBe(otherId);

    // Both resolve, each under its own café, and neither can be read
    // through the other's address.
    expect((await getPublishedMenuByPath(db, "cafe-a", "cafe-a-menu"))!.menuId).toBe(menuId);
    expect(await getPublishedMenuByPath(db, "cafe-c", "cafe-a-menu")).toBeNull();

    // An explicitly chosen slug is only taken *within* one restaurant.
    const explicitId = "menu-pub-b2";
    await createMenuForUser(db, ownerB, restaurantB, sampleDoc(explicitId, "Other"));
    await publishMenuForUser(db, ownerB, explicitId, { slug: "taken-link" });
    expect((await getPublishedMenuByPath(db, "cafe-b", "taken-link"))!.menuId).toBe(explicitId);
  });

  it("refuses a slug the owner explicitly asked for when it is taken at this restaurant", async () => {
    await publish("taken-link");
    const secondId = "menu-pub-3";
    await createMenuForUser(db, ownerA, restaurantA, sampleDoc(secondId, "Other"));
    await expect(
      publishMenuForUser(db, ownerA, secondId, { slug: "taken-link" })
    ).rejects.toMatchObject({ code: "slug_taken" });
  });

  it("unpublishes without releasing the slug, and reuses it on republish", async () => {
    await publish();

    const unpublished = await unpublishMenuForUser(db, ownerA, menuId);
    expect(unpublished.isLive).toBe(false);
    expect(unpublished.publishedAt).toBeNull();
    expect(unpublished.liveRevisionId).toBeNull();
    // The address is reserved but stops serving.
    expect(await getPublishedMenuByPath(db, "cafe-a", "cafe-a-menu")).toBeNull();

    const republished = await publish();
    expect(republished.isLive).toBe(true);
    // Republishing reused the reserved slug instead of deriving a new one.
    expect(await getPublishedMenuByPath(db, "cafe-a", "cafe-a-menu")).not.toBeNull();
    expect(await getPublishedMenuByPath(db, "cafe-a", "cafe-a-menu-2")).toBeNull();
  });

  it("keeps other tenants out and lets staff read but never publish", async () => {
    await publish();
    await createRestaurant(db, ownerB, "Café B");

    await expect(getPublicationStatus(db, ownerB, menuId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(publishMenuForUser(db, ownerB, menuId, {})).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(unpublishMenuForUser(db, ownerB, menuId)).rejects.toMatchObject({
      code: "not_found",
    });

    const staffId = await seedUser(db, "staff@cafe.test", "Staff");
    await db
      .insert(restaurantMembership)
      .values({ restaurantId: restaurantA, userId: staffId, role: "staff" });
    // Staff may see the status…
    expect((await getPublicationStatus(db, staffId, menuId))!.isLive).toBe(true);
    // …but never publish or unpublish.
    await expect(publishMenuForUser(db, staffId, menuId, {})).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(unpublishMenuForUser(db, staffId, menuId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("reports a menu that was never published as null, not an error", async () => {
    expect(await getPublicationStatus(db, ownerA, menuId)).toBeNull();
    expect(await db.select({ id: publishedMenu.id }).from(publishedMenu)).toHaveLength(0);
  });

  it("rejects publishing an invalid document rather than storing garbage", async () => {
    // Corrupt the stored doc the way a bad migration would.
    await db.execute("update menu set doc = '{\"nope\":true}'::jsonb");
    await expect(publish()).rejects.toBeInstanceOf(PublicationRepoError);
    expect(await db.select({ id: publishedMenu.id }).from(publishedMenu)).toHaveLength(0);
  });
});
