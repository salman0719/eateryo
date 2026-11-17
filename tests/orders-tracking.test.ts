import { beforeEach, describe, expect, it } from "vitest";

import { createMenuForUser } from "@/features/menus/repo";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import {
  createOrderTrackingToken,
  getOrderByTrackingToken,
  hashTrackingToken,
  placeOrderFromSlug,
  TRACK_HARD_CAP_MS,
  updateOrderStatusForStaff,
} from "@/features/orders/repo";
import { publishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { orderTracking } from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * Diner order tracking v1: a per-order bearer token, read-only and scoped.
 * Pins the locked decisions — sha256 storage, 7-day cap, 24h terminal grace,
 * generic miss (never "exists but wrong token").
 */
describe("order tracking tokens", () => {
  let db: TestDb;
  let owner: string;
  const menuId = "menu-tracking-1";

  function menuDoc(): MenuDocument {
    return menuDocumentSchema.parse({
      schemaVersion: 1,
      id: menuId,
      title: "Café Tracking",
      currency: "USD",
      updatedAt: new Date().toISOString(),
      categories: [
        {
          id: "cat",
          name: "Drinks",
          sortOrder: 0,
          items: [
            {
              id: "item-flat",
              name: "Espresso",
              description: null,
              currency: null,
              price: 3.5,
              sortOrder: 0,
              available: true,
              dietaryLabels: [],
              variants: [],
              options: [],
              reviewNotes: [],
            },
          ],
        },
      ],
    });
  }

  beforeEach(async () => {
    ({ db } = await createTestDb());
    owner = await seedUser(db, "tracking-owner@cafe.test", "Owner");
    const restaurant = await createRestaurant(db, owner, "Café Tracking");
    await createMenuForUser(db, owner, restaurant.id, menuDoc());
    await publishMenuForUser(db, owner, menuId);
  }, 30_000);

  function place() {
    return placeOrderFromSlug(db, {
      restaurantSlug: "cafe-tracking",
      slug: "cafe-tracking",
      tableLabel: "1",
      lines: [{ menuItemId: "item-flat", quantity: 1 }],
    });
  }

  it("mints a token whose hash — never the raw value — is stored", async () => {
    const placed = await place();
    const { token, expiresAt } = await createOrderTrackingToken(db, placed.id);
    expect(token.length).toBeGreaterThan(20);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(TRACK_HARD_CAP_MS - 60_000);

    const rows = await db.select().from(orderTracking);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.orderId).toBe(placed.id);
    expect(rows[0]?.tokenHash).toBe(hashTrackingToken(token));
    expect(rows[0]?.tokenHash).not.toContain(token.slice(0, 8));

    const resolved = await getOrderByTrackingToken(db, token);
    expect(resolved?.id).toBe(placed.id);
    expect(resolved?.lines[0]?.name).toBe("Espresso");
  });

  it("answers null for unknown, blank, and overlong tokens", async () => {
    await place();
    expect(await getOrderByTrackingToken(db, "nope")).toBeNull();
    expect(await getOrderByTrackingToken(db, "")).toBeNull();
    expect(await getOrderByTrackingToken(db, "x".repeat(300))).toBeNull();
  });

  it("expires past the hard cap and past the terminal grace window", async () => {
    const placed = await place();
    const { token } = await createOrderTrackingToken(db, placed.id);

    // Active order resolves inside the cap; past the cap it does not.
    expect(await getOrderByTrackingToken(db, token)).not.toBeNull();
    expect(
      await getOrderByTrackingToken(db, token, new Date(Date.now() + TRACK_HARD_CAP_MS + 1000))
    ).toBeNull();

    // Terminal + recent still resolves; a clock 25h past serving does not.
    await updateOrderStatusForStaff(db, owner, placed.id, "preparing");
    await updateOrderStatusForStaff(db, owner, placed.id, "served");
    const served = await getOrderByTrackingToken(db, token);
    expect(served?.status).toBe("served");
    expect(
      await getOrderByTrackingToken(db, token, new Date(Date.now() + 25 * 60 * 60 * 1000))
    ).toBeNull();
  });
});
