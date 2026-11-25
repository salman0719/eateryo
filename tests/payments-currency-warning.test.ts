import { beforeEach, describe, expect, it } from "vitest";

import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createMenuForUser } from "@/features/menus/repo";
import { getLiveMenuCurrencyWarnings } from "@/features/payments/accounts";
import { publishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * C4 card-setup warn: the Settings card names the live menus whose prices
 * cannot be charged by card, reading the same live snapshots ordering
 * prices from. Unpublished menus stay silent, outsiders learn nothing.
 */

describe("getLiveMenuCurrencyWarnings", () => {
  let db: TestDb;
  let ownerId: string;
  let outsiderId: string;
  let restaurantId: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    ownerId = await seedUser(db, "currency-owner@cafe.test", "Owner");
    outsiderId = await seedUser(db, "currency-outsider@cafe.test", "Outsider");
    restaurantId = (await createRestaurant(db, ownerId, "Café Currency")).id;
  }, 30_000);

  function sampleDoc(id: string, title: string, currency: string | null): MenuDocument {
    return menuDocumentSchema.parse({ ...createSampleMenuDocument(), id, title, currency });
  }

  async function publishLive(id: string, title: string, currency: string | null) {
    await createMenuForUser(db, ownerId, restaurantId, sampleDoc(id, title, currency));
    await publishMenuForUser(db, ownerId, id, {});
  }

  it("stays silent when every live menu prices in AUD", async () => {
    await publishLive("menu-aud", "Lunch", "AUD");
    await expect(getLiveMenuCurrencyWarnings(db, ownerId, restaurantId)).resolves.toEqual([]);
  });

  it("names live menus with a symbol-only or missing currency", async () => {
    await publishLive("menu-symbol", "Dinner", "$");
    await publishLive("menu-missing", "Brunch", null);
    await publishLive("menu-aud", "Lunch", "aud");
    await expect(getLiveMenuCurrencyWarnings(db, ownerId, restaurantId)).resolves.toEqual([
      { menuTitle: "Brunch", currency: null },
      { menuTitle: "Dinner", currency: "$" },
    ]);
  });

  it("ignores menus that are not live and learns nothing across tenants", async () => {
    await createMenuForUser(db, ownerId, restaurantId, sampleDoc("menu-draft", "Draft", "$"));
    await publishLive("menu-live", "Lunch", "AUD");
    await expect(getLiveMenuCurrencyWarnings(db, ownerId, restaurantId)).resolves.toEqual([]);
    await expect(getLiveMenuCurrencyWarnings(db, outsiderId, restaurantId)).resolves.toEqual([]);
  });
});
