import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addCategory, addItem, createMenuDocument } from "@/features/menu/menu-utils";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema } from "@/features/menu/schema";
import { createMenuForUser } from "@/features/menus/repo";
import { fetchLaunchStatus } from "@/features/launch/client";
import { getLaunchSnapshot } from "@/features/launch/repo";
import type { LaunchSnapshot } from "@/features/launch/schema";
import { launchSteps, verifiedProgress } from "@/features/launch/steps";
import { placeOrderFromSlug } from "@/features/orders/repo";
import { publishMenuForUser } from "@/features/publishing/repo";
import { setRestaurantSlugForUser } from "@/features/tables/repo";
import { createRestaurant, listRestaurantsForUser } from "@/features/tenancy/repo";
import { publishedMenu, restaurantMembership } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

const holder: { db: TestDb | null; userId: string | null } = { db: null, userId: null };

vi.mock("@/lib/auth/session", () => ({
  getSessionUserId: vi.fn(async () => holder.userId),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

const emptySnapshot: LaunchSnapshot = {
  menuCount: 0,
  publishedCount: 0,
  orderCount: 0,
  unpricedItems: 0,
  reviewNotes: 0,
  unreadableMenus: 0,
};

describe("launch steps", () => {
  it("marks nothing done for a brand-new account and counts only verifiable steps", () => {
    const steps = launchSteps(emptySnapshot);
    expect(steps.map((step) => step.id)).toEqual([
      "extract",
      "review",
      "cards",
      "publish",
      "order",
    ]);
    expect(steps.filter((step) => step.done)).toHaveLength(0);
    expect(steps.find((step) => step.id === "cards")?.manual).toBe(true);
    expect(verifiedProgress(steps)).toEqual({ done: 0, total: 4 });
  });

  it("keeps review open while any item is unpriced or noted", () => {
    const steps = launchSteps({
      ...emptySnapshot,
      menuCount: 1,
      unpricedItems: 2,
      reviewNotes: 1,
    });
    const review = steps.find((step) => step.id === "review");
    expect(review?.done).toBe(false);
    expect(review?.detail).toBe("3 items still need a look");
    expect(steps.find((step) => step.id === "extract")?.done).toBe(true);
  });

  it("reports a published menu and the first order once they exist", () => {
    const steps = launchSteps({
      ...emptySnapshot,
      menuCount: 2,
      publishedCount: 1,
      orderCount: 3,
    });
    expect(steps.find((step) => step.id === "publish")).toMatchObject({
      done: true,
      detail: "Offered at your table cards",
    });
    expect(steps.find((step) => step.id === "order")).toMatchObject({
      done: true,
      detail: "3 orders received",
    });
    // Printing is still the owner's word, not our inference.
    expect(steps.find((step) => step.id === "cards")?.done).toBe(false);
  });

  it("does not let unreadable menus hide behind a clean count", () => {
    const steps = launchSteps({ ...emptySnapshot, menuCount: 1, unreadableMenus: 1 });
    expect(steps.find((step) => step.id === "extract")?.done).toBe(true);
  });
});

describe("launch snapshot", () => {
  let db: TestDb;
  let ownerId: string;
  let otherId: string;
  let restaurantId: string;

  beforeEach(async () => {
    const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
    ({ db } = await createTestDb());
    ownerId = await seedUser(db, "launch-owner@cafe.test", "Owner");
    otherId = await seedUser(db, "launch-other@cafe.test", "Other");
    restaurantId = (await createRestaurant(db, ownerId, "Launch Café")).id;
  }, 30_000);

  it("reports an empty account as empty", async () => {
    await expect(getLaunchSnapshot(db, ownerId, restaurantId)).resolves.toEqual(emptySnapshot);
  });

  it("counts a size-priced item as priced, not as a review item", async () => {
    let doc = createMenuDocument({ title: "Pizzeria", currency: "€" });
    doc = addCategory(doc, { name: "Traditional Pizzas" });
    doc = addItem(doc, doc.categories[0].id, {
      name: "Margherita",
      variants: [
        { name: "S", price: 9 },
        { name: "M", price: 11 },
        { name: "L", price: 15 },
      ],
    });
    await createMenuForUser(db, ownerId, restaurantId, doc);

    await expect(getLaunchSnapshot(db, ownerId, restaurantId)).resolves.toMatchObject({
      menuCount: 1,
      unpricedItems: 0,
      reviewNotes: 0,
    });
  }, 30_000);

  it("counts menus, review flags, and orders — for the right tenant only", async () => {
    const doc = menuDocumentSchema.parse({
      ...createSampleMenuDocument(),
      id: "menu-launch-a",
      title: "Launch Café Menu",
    });
    await createMenuForUser(db, ownerId, restaurantId, doc);
    await publishMenuForUser(db, ownerId, "menu-launch-a");
    await setRestaurantSlugForUser(db, ownerId, restaurantId, "launch-cafe");
    const publicationRows = await db
      .select({ slug: publishedMenu.slug })
      .from(publishedMenu)
      .where(eq(publishedMenu.menuId, "menu-launch-a"));
    const menuSlug = publicationRows[0]?.slug;
    if (!menuSlug) throw new Error("publication row missing");

    await placeOrderFromSlug(db, {
      restaurantSlug: "launch-cafe",
      slug: menuSlug,
      tableLabel: "2",
      note: null,
      lines: [
        { menuItemId: doc.categories[0].items[0].id, variantName: "Double", quantity: 1 },
      ],
    });

    const snapshot = await getLaunchSnapshot(db, ownerId, restaurantId);
    expect(snapshot).toMatchObject({
      menuCount: 1,
      publishedCount: 1,
      orderCount: 1,
      unpricedItems: 1,
      reviewNotes: 2,
      unreadableMenus: 0,
    });

    // The other account sees none of it.
    await expect(getLaunchSnapshot(db, otherId, restaurantId)).resolves.toEqual(emptySnapshot);
  });

  it("keeps an owner's two cafés apart", async () => {
    const second = await createRestaurant(db, ownerId, "Second Café");
    const base = menuDocumentSchema.parse({
      ...createSampleMenuDocument(),
      id: "menu-scope-first",
      title: "First Café Menu",
    });
    await createMenuForUser(db, ownerId, restaurantId, base);
    await createMenuForUser(db, ownerId, second.id, {
      ...base,
      id: "menu-scope-second",
      title: "Second Café Menu",
    });

    await expect(getLaunchSnapshot(db, ownerId, restaurantId)).resolves.toMatchObject({
      menuCount: 1,
    });
    await expect(getLaunchSnapshot(db, ownerId, second.id)).resolves.toMatchObject({
      menuCount: 1,
    });

    await createMenuForUser(db, ownerId, second.id, {
      ...base,
      id: "menu-scope-second-2",
      title: "Second Café Menu 2",
    });
    await expect(getLaunchSnapshot(db, ownerId, restaurantId)).resolves.toMatchObject({
      menuCount: 1,
    });
    await expect(getLaunchSnapshot(db, ownerId, second.id)).resolves.toMatchObject({
      menuCount: 2,
    });
  });
});

describe("GET /api/launch", () => {
  let apiCafeId: string;

  /** The café is part of the request: there is no account-wide answer. */
  function launchRequest(restaurantId?: string) {
    const query = restaurantId ? `?restaurantId=${encodeURIComponent(restaurantId)}` : "";
    return new Request(`http://localhost/api/launch${query}`);
  }

  beforeEach(async () => {
    const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
    const { db } = await createTestDb();
    holder.db = db;
    holder.userId = await seedUser(db, "launch-api@cafe.test", "API Owner");
    apiCafeId = (await createRestaurant(db, holder.userId, "API Café")).id;
  }, 30_000);

  it("returns the checklist state plus this month's usage", async () => {
    const { GET } = await import("@/app/api/launch/route");
    const response = await GET(launchRequest(apiCafeId));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      launch: LaunchSnapshot & {
        usage: { requests: number; cap: number; remaining: number } | null;
        assistant: { messages: number; cap: number; remaining: number; costMicros: number | null };
      };
    };
    expect(body.launch).toMatchObject({ menuCount: 0, publishedCount: 0, orderCount: 0 });
    expect(body.launch.usage).toMatchObject({ requests: 0, remaining: body.launch.usage?.cap });
    expect(body.launch.assistant).toMatchObject({
      messages: 0,
      remaining: body.launch.assistant.cap,
      costMicros: 0,
    });
  }, 30_000);

  it("refuses a request without a café", async () => {
    const { GET } = await import("@/app/api/launch/route");
    const response = await GET(launchRequest());
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_body");
  });

  it("404s a café on another account instead of reading it", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const stranger = await seedUser(holder.db!, "launch-stranger@cafe.test", "Stranger");
    const theirs = await createRestaurant(holder.db!, stranger, "Stranger Café");
    const { GET } = await import("@/app/api/launch/route");
    const response = await GET(launchRequest(theirs.id));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("answers 401 when signed out", async () => {
    holder.userId = null;
    const { GET } = await import("@/app/api/launch/route");
    const response = await GET(launchRequest(apiCafeId));
    expect(response.status).toBe(401);
  });

  it("answers 403 for a staff account: the checklist is the owner's", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const staff = await seedUser(holder.db!, "launch-staff@cafe.test", "Staff");
    const [place] = await listRestaurantsForUser(holder.db!, holder.userId!);
    await holder.db!.insert(restaurantMembership).values({
      restaurantId: place.id,
      userId: staff,
      role: "staff",
    });
    holder.userId = staff;

    const { GET } = await import("@/app/api/launch/route");
    const response = await GET(launchRequest(place.id));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
  });
});

/**
 * The checklist, and every other caller of this client, decides from the
 * error code — so the 403 that a staff membership gets must arrive as
 * `forbidden`, not as a generic "unavailable" with a retry that cannot work.
 */
describe("fetchLaunchStatus error mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [503, "unavailable"],
  ] as const)("maps %s to %s", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      async () => jsonResponse({ error: { code: "server_code", message: "nope" } }, status)
    );

    await expect(fetchLaunchStatus("cafe-1")).rejects.toMatchObject({ code });
  });

  it("asks for the café it is given, once", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        launch: {
          menuCount: 0,
          publishedCount: 0,
          orderCount: 0,
          unpricedItems: 0,
          reviewNotes: 0,
          unreadableMenus: 0,
          usage: null,
          assistant: {
            periodStart: "2026-10-01T00:00:00.000Z",
            periodEnd: "2026-11-01T00:00:00.000Z",
            messages: 0,
            cap: 300,
            remaining: 300,
            neurons: null,
            costMicros: null,
            unpricedMessages: 0,
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLaunchStatus("café 1")).resolves.toMatchObject({ menuCount: 0 });
    expect(fetchMock).toHaveBeenCalledWith("/api/launch?restaurantId=caf%C3%A9+1", {
      cache: "no-store",
    });
  });
});
