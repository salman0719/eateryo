import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as trackOrder } from "@/app/api/orders/track/route";
import { POST as placeOrderRoute } from "@/app/api/orders/route";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createMenuForUser } from "@/features/menus/repo";
import { publishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * Public track-route tests: the POST issues a one-time token, the GET
 * resolves it with `no-store`, and misses all answer one generic 404.
 */

const holder: { db: TestDb | null } = { db: null };

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

let publishedDoc: MenuDocument;
const menuId = "menu-track-api";
let callerCounter = 0;

function menuDoc(): MenuDocument {
  return menuDocumentSchema.parse({
    ...createSampleMenuDocument(),
    id: menuId,
    title: "Café Track API",
    currency: "USD",
  });
}

function callerHeaders(ip = `10.1.0.${(callerCounter += 1)}`): Record<string, string> {
  return { "content-type": "application/json", "x-forwarded-for": ip };
}

function orderRequest(body: unknown, ip?: string): Request {
  return new Request("http://test.local/api/orders", {
    method: "POST",
    headers: callerHeaders(ip),
    body: JSON.stringify(body),
  });
}

function sampleLine() {
  const item = publishedDoc.categories
    .flatMap((category) => category.items)
    .find((candidate) => candidate.available !== false)!;
  return {
    menuItemId: item.id,
    ...(item.variants.length > 0 ? { variantName: item.variants[0].name } : {}),
    quantity: 1,
  };
}

beforeEach(async () => {
  const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
  const { db } = await createTestDb();
  holder.db = db;
  const owner = await seedUser(db, "track-api-owner@cafe.test", "Owner");
  const restaurant = await createRestaurant(db, owner, "Café Track API");
  publishedDoc = menuDoc();
  await createMenuForUser(db, owner, restaurant.id, publishedDoc);
  await publishMenuForUser(db, owner, menuId);
}, 30_000);

describe("GET /api/orders/track", () => {
  it("issues a token on POST and resolves it on the track route", async () => {
    const placed = await placeOrderRoute(
      orderRequest({
        restaurantSlug: "cafe-track-api",
        slug: "cafe-track-api",
        tableLabel: "4",
        note: null,
        lines: [sampleLine()],
      })
    );
    expect(placed.status).toBe(201);
    const body = await placed.json();
    expect(body.order.status).toBe("new");
    expect(typeof body.tracking?.token).toBe("string");
    expect(placed.headers.get("Cache-Control")).toBe("no-store");

    const tracked = await trackOrder(
      new Request(
        `http://test.local/api/orders/track?token=${encodeURIComponent(body.tracking.token)}`
      )
    );
    expect(tracked.status).toBe(200);
    expect(tracked.headers.get("Cache-Control")).toBe("no-store");
    const trackedBody = await tracked.json();
    expect(trackedBody.order.id).toBe(body.order.id);
    expect(trackedBody.order.status).toBe("new");
    expect(typeof trackedBody.serverTime).toBe("string");
  });

  it("answers one generic 404 for unknown, missing, and overlong tokens", async () => {
    for (const token of ["nope", "", "x".repeat(300)]) {
      const res = await trackOrder(
        new Request(`http://test.local/api/orders/track?token=${encodeURIComponent(token)}`)
      );
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const payload = await res.json();
      expect(payload.error.code).toBe("not_found");
    }
    const missing = await trackOrder(new Request("http://test.local/api/orders/track"));
    expect(missing.status).toBe(404);
  });
});
