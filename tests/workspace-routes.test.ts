import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getAccountUsage } from "@/app/api/account/usage/route";
import { GET as getCafeLaunch } from "@/app/api/restaurants/[restaurantId]/launch/route";
import {
  GET as listCafeMenus,
  POST as createCafeMenu,
} from "@/app/api/restaurants/[restaurantId]/menus/route";
import { GET as getCafeOrders } from "@/app/api/restaurants/[restaurantId]/orders/route";
import { GET as getCafeTables } from "@/app/api/restaurants/[restaurantId]/tables/route";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createMenuForUser } from "@/features/menus/repo";
import { placeOrderFromSlug } from "@/features/orders/repo";
import { publishMenuForUser } from "@/features/publishing/repo";
import { setRestaurantSlugForUser } from "@/features/tables/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { publishedMenu, restaurantMembership } from "@/lib/db/schema";

import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * The café-scoped contract (phase 1): every list read names its café in the
 * path, and the server — not the browser — decides what that membership may
 * see. These tests pin the three answers a reviewer cares about: the named
 * café's rows and nothing else, 404 for a café on another account, and 403
 * only for a member whose capabilities do not cover the read.
 *
 * The old account-wide routes stay for the current UI; they are unchanged by
 * this file, so these assertions are about the replacement paths only.
 */

const holder: { db: TestDb | null; userId: string | null } = {
  db: null,
  userId: null,
};

vi.mock("@/lib/auth/session", () => ({
  getSessionUserId: vi.fn(async () => holder.userId),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

function params(restaurantId: string): { params: Promise<{ restaurantId: string }> } {
  return { params: Promise.resolve({ restaurantId }) };
}

function get(path = "/api/restaurants/x/menus"): Request {
  return new Request(`http://test.local${path}`);
}

function createRequest(body: unknown): Request {
  return new Request("http://test.local/api/restaurants/x/menus", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A valid menu document with a chosen id (ids are global, so keep them apart). */
function doc(id: string, title = "Menu"): MenuDocument {
  return menuDocumentSchema.parse({ ...createSampleMenuDocument(), id, title });
}

/**
 * Add a staff membership. An empty grant means "the role's defaults", which
 * is how the schema stores an untouched staff row.
 */
async function addStaff(
  db: TestDb,
  restaurantId: string,
  userId: string,
  permissions: string[] = []
): Promise<void> {
  await db
    .insert(restaurantMembership)
    .values({ restaurantId, userId, role: "staff", permissions });
}

/**
 * Publish one menu and claim the café's `/r/<slug>` address, returning the
 * menu's own slug — the setup a real order needs.
 */
async function publishWithSlug(
  db: TestDb,
  ownerId: string,
  restaurantId: string,
  menu: MenuDocument,
  restaurantSlug: string
): Promise<string> {
  await createMenuForUser(db, ownerId, restaurantId, menu);
  await publishMenuForUser(db, ownerId, menu.id);
  await setRestaurantSlugForUser(db, ownerId, restaurantId, restaurantSlug);
  const rows = await db
    .select({ slug: publishedMenu.slug })
    .from(publishedMenu)
    .where(eq(publishedMenu.menuId, menu.id));
  const slug = rows[0]?.slug;
  if (!slug) throw new Error("publication row missing");
  return slug;
}

beforeEach(async () => {
  const { db } = await createTestDb();
  holder.db = db;
  holder.userId = null;
}, 30_000);

describe("GET /api/restaurants/[restaurantId]/menus", () => {
  it("answers 401 when signed out", async () => {
    const response = await listCafeMenus(get(), params("cafe-1"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("returns the named café's menus and that membership's capabilities", async () => {
    const owner = await seedUser(holder.db!, "menus-owner@cafe.test", "Owner");
    const other = await seedUser(holder.db!, "menus-other@cafe.test", "Other");
    const mine = await createRestaurant(holder.db!, owner, "Mine");
    const theirs = await createRestaurant(holder.db!, other, "Theirs");
    await createMenuForUser(holder.db!, owner, mine.id, doc("menu-mine"));
    await createMenuForUser(holder.db!, other, theirs.id, doc("menu-theirs"));
    // A staff shift sees only live menus, so publish theirs to make it visible.
    await publishMenuForUser(holder.db!, other, "menu-theirs");
    await addStaff(holder.db!, theirs.id, owner);

    holder.userId = owner;

    const own = await listCafeMenus(get(), params(mine.id));
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe("no-store");
    const ownBody = (await own.json()) as {
      workspace: { id: string; role: string; capabilities: string[] };
      menus: { id: string }[];
    };
    expect(ownBody.workspace).toMatchObject({ id: mine.id, role: "owner" });
    expect(ownBody.workspace.capabilities).toContain("menus.write");
    expect(ownBody.menus.map((menu) => menu.id)).toEqual(["menu-mine"]);

    const shift = await listCafeMenus(get(), params(theirs.id));
    expect(shift.status).toBe(200);
    const shiftBody = (await shift.json()) as {
      workspace: { role: string; capabilities: string[] };
      menus: { id: string }[];
    };
    expect(shiftBody.workspace.role).toBe("staff");
    expect(shiftBody.workspace.capabilities).not.toContain("menus.write");
    expect(shiftBody.menus.map((menu) => menu.id)).toEqual(["menu-theirs"]);
  });

  it("404s a café on another account instead of listing it", async () => {
    const owner = await seedUser(holder.db!, "menus-owner@cafe.test", "Owner");
    const stranger = await seedUser(holder.db!, "menus-stranger@cafe.test", "Stranger");
    const theirs = await createRestaurant(holder.db!, stranger, "Stranger Café");
    holder.userId = owner;

    const response = await listCafeMenus(get(), params(theirs.id));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("returns an empty list for a member who may not read menus", async () => {
    const owner = await seedUser(holder.db!, "menus-owner@cafe.test", "Owner");
    const cafe = await createRestaurant(holder.db!, owner, "Café");
    await createMenuForUser(holder.db!, owner, cafe.id, doc("menu-hidden"));
    const staff = await seedUser(holder.db!, "menus-staff@cafe.test", "Staff");
    // An explicit grant replaces the staff defaults; orders only.
    await addStaff(holder.db!, cafe.id, staff, ["orders.read"]);
    holder.userId = staff;

    const response = await listCafeMenus(get(), params(cafe.id));
    expect(response.status).toBe(200);
    expect((await response.json()).menus).toEqual([]);
  });
});

describe("POST /api/restaurants/[restaurantId]/menus", () => {
  it("creates the menu in the café named by the path", async () => {
    const owner = await seedUser(holder.db!, "create-owner@cafe.test", "Owner");
    const cafe = await createRestaurant(holder.db!, owner, "Café");
    holder.userId = owner;

    const response = await createCafeMenu(createRequest({ doc: doc("menu-created") }), params(cafe.id));
    expect(response.status).toBe(201);
    expect((await response.json()).menu).toMatchObject({
      id: "menu-created",
      restaurantId: cafe.id,
    });
  });

  it("refuses a body that tries to name its own café", async () => {
    const owner = await seedUser(holder.db!, "create-owner@cafe.test", "Owner");
    const cafe = await createRestaurant(holder.db!, owner, "Café");
    holder.userId = owner;

    const response = await createCafeMenu(
      createRequest({ restaurantId: cafe.id, doc: doc("menu-smuggled") }),
      params(cafe.id)
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_body" } });
  });

  it("403s a staff member", async () => {
    const owner = await seedUser(holder.db!, "create-owner@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "create-staff@cafe.test", "Staff");
    const cafe = await createRestaurant(holder.db!, owner, "Café");
    await addStaff(holder.db!, cafe.id, staff);
    holder.userId = staff;

    const response = await createCafeMenu(createRequest({ doc: doc("menu-staff") }), params(cafe.id));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("404s a café on another account", async () => {
    const owner = await seedUser(holder.db!, "create-owner@cafe.test", "Owner");
    const stranger = await seedUser(holder.db!, "create-stranger@cafe.test", "Stranger");
    const theirs = await createRestaurant(holder.db!, stranger, "Theirs");
    holder.userId = owner;

    const response = await createCafeMenu(createRequest({ doc: doc("menu-foreign") }), params(theirs.id));
    expect(response.status).toBe(404);
  });
});

describe("GET /api/restaurants/[restaurantId]/orders", () => {
  it("404s a café on another account", async () => {
    const owner = await seedUser(holder.db!, "orders-owner@cafe.test", "Owner");
    const stranger = await seedUser(holder.db!, "orders-stranger@cafe.test", "Stranger");
    const theirs = await createRestaurant(holder.db!, stranger, "Theirs");
    holder.userId = owner;

    const response = await getCafeOrders(get(), params(theirs.id));
    expect(response.status).toBe(404);
  });

  it("403s a member who does not take orders", async () => {
    const owner = await seedUser(holder.db!, "orders-owner@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "orders-staff@cafe.test", "Staff");
    const cafe = await createRestaurant(holder.db!, owner, "Café");
    await addStaff(holder.db!, cafe.id, staff, ["tables.print"]);
    holder.userId = staff;

    const response = await getCafeOrders(get(), params(cafe.id));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("returns one café's orders and never the other membership's", async () => {
    const owner = await seedUser(holder.db!, "orders-owner@cafe.test", "Owner");
    const other = await seedUser(holder.db!, "orders-other@cafe.test", "Other");
    const mine = await createRestaurant(holder.db!, owner, "Mine");
    const theirs = await createRestaurant(holder.db!, other, "Theirs");
    const menu = doc("menu-orders", "Mine Menu");
    const menuSlug = await publishWithSlug(holder.db!, owner, mine.id, menu, "mine-cafe");
    const item = menu.categories
      .flatMap((category) => category.items)
      .find((candidate) => candidate.available !== false)!;
    await placeOrderFromSlug(holder.db!, {
      restaurantSlug: "mine-cafe",
      slug: menuSlug,
      tableLabel: "2",
      note: null,
      lines: [
        {
          menuItemId: item.id,
          variantName: item.variants[0]?.name ?? null,
          quantity: 1,
        },
      ],
    });
    // The same person works a shift at the other café.
    await addStaff(holder.db!, theirs.id, owner);
    holder.userId = owner;

    const own = await getCafeOrders(get(), params(mine.id));
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as {
      workspace: { id: string };
      orders: unknown[];
      serverTime: string;
    };
    expect(ownBody.workspace.id).toBe(mine.id);
    expect(ownBody.orders).toHaveLength(1);
    expect(ownBody.serverTime).toEqual(expect.any(String));

    const shift = await getCafeOrders(get(), params(theirs.id));
    expect(shift.status).toBe(200);
    expect((await shift.json()).orders).toEqual([]);
  });
});

describe("GET /api/restaurants/[restaurantId]/tables", () => {
  it("404s a café on another account", async () => {
    const owner = await seedUser(holder.db!, "tables-owner@cafe.test", "Owner");
    const stranger = await seedUser(holder.db!, "tables-stranger@cafe.test", "Stranger");
    const theirs = await createRestaurant(holder.db!, stranger, "Theirs");
    holder.userId = owner;

    const response = await getCafeTables(get(), params(theirs.id));
    expect(response.status).toBe(404);
  });

  it("403s a member who does not print cards", async () => {
    const owner = await seedUser(holder.db!, "tables-owner@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "tables-staff@cafe.test", "Staff");
    const cafe = await createRestaurant(holder.db!, owner, "Café");
    await addStaff(holder.db!, cafe.id, staff, ["orders.read"]);
    holder.userId = staff;

    const response = await getCafeTables(get(), params(cafe.id));
    expect(response.status).toBe(403);
  });

  it("answers an unclaimed café with a null address and no menus", async () => {
    const owner = await seedUser(holder.db!, "tables-owner@cafe.test", "Owner");
    const cafe = await createRestaurant(holder.db!, owner, "Café");
    holder.userId = owner;

    const response = await getCafeTables(get(), params(cafe.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { slug: string | null; menus: unknown[] };
    expect(body.slug).toBeNull();
    expect(body.menus).toEqual([]);
  });

  it("lists only live menus, with the café's own address", async () => {
    const owner = await seedUser(holder.db!, "tables-owner@cafe.test", "Owner");
    const cafe = await createRestaurant(holder.db!, owner, "Café");
    const liveMenu = doc("menu-live", "Live Menu");
    const liveSlug = await publishWithSlug(holder.db!, owner, cafe.id, liveMenu, "table-cafe");
    // A draft in the same café must not appear on a printed card.
    await createMenuForUser(holder.db!, owner, cafe.id, doc("menu-draft", "Draft Menu"));
    holder.userId = owner;

    const response = await getCafeTables(get(), params(cafe.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      slug: string | null;
      menus: { menuId: string; title: string; slug: string }[];
    };
    expect(body.slug).toBe("table-cafe");
    expect(body.menus).toEqual([
      { menuId: "menu-live", title: "Live Menu", slug: liveSlug, publishedAt: expect.any(String) },
    ]);
  });
});

describe("GET /api/restaurants/[restaurantId]/launch", () => {
  it("returns the checklist for the café's owner", async () => {
    const owner = await seedUser(holder.db!, "launch-owner@cafe.test", "Owner");
    const cafe = await createRestaurant(holder.db!, owner, "Café");
    holder.userId = owner;

    const response = await getCafeLaunch(get(), params(cafe.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workspace: { id: string; capabilities: string[] };
      launch: { menuCount: number; usage: { cap: number } | null; assistant: { cap: number } };
    };
    expect(body.workspace.id).toBe(cafe.id);
    expect(body.workspace.capabilities).toContain("settings.manage");
    expect(body.launch).toMatchObject({ menuCount: 0, orderCount: 0 });
    expect(body.launch.usage?.cap).toBeGreaterThan(0);
    expect(body.launch.assistant.cap).toBeGreaterThan(0);
  });

  it("403s a staff membership: the checklist is the owner's", async () => {
    const owner = await seedUser(holder.db!, "launch-owner@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "launch-staff@cafe.test", "Staff");
    const cafe = await createRestaurant(holder.db!, owner, "Café");
    await addStaff(holder.db!, cafe.id, staff);
    holder.userId = staff;

    const response = await getCafeLaunch(get(), params(cafe.id));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("404s a café on another account", async () => {
    const owner = await seedUser(holder.db!, "launch-owner@cafe.test", "Owner");
    const stranger = await seedUser(holder.db!, "launch-stranger@cafe.test", "Stranger");
    const theirs = await createRestaurant(holder.db!, stranger, "Theirs");
    holder.userId = owner;

    const response = await getCafeLaunch(get(), params(theirs.id));
    expect(response.status).toBe(404);
  });
});

describe("GET /api/account/usage", () => {
  it("answers with both spend halves and names no café", async () => {
    holder.userId = await seedUser(holder.db!, "usage-account@cafe.test", "Account");

    const response = await getAccountUsage();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      usage: { requests: number; cap: number };
      assistant: { messages: number; cap: number };
    };
    expect(body.usage).toMatchObject({ requests: 0 });
    expect(body.usage.cap).toBeGreaterThan(0);
    expect(body.assistant).toMatchObject({ messages: 0 });
    expect(body.assistant.cap).toBeGreaterThan(0);
  });

  it("is session-gated", async () => {
    const response = await getAccountUsage();
    expect(response.status).toBe(401);
  });
});
