import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getLiveDoc } from "@/app/api/menus/[menuId]/publication/live/route";
import {
  DELETE as unpublish,
  GET as getPublication,
  POST as publish,
} from "@/app/api/menus/[menuId]/publication/route";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createMenuForUser, getMenuForUser, updateMenuForUser } from "@/features/menus/repo";
import { getPublishedMenuByPath } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { restaurantMembership } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * HTTP-surface tests for Step 9 publishing (PGlite + real handlers, only the
 * session lookup stubbed). These pin the status codes the UI depends on:
 * 401 signed out, 404 for other tenants, 403 for staff, 400 for bad input,
 * and 409 for a taken slug. Publishing feeds table ordering only, so the
 * status carries no URL, theme, or view count.
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

async function initTestDb(): Promise<TestDb> {
  const { createTestDb } = await import("./helpers/pg-test-db");
  const { db } = await createTestDb();
  return db;
}

function jsonRequest(method: string, body: unknown): Request {
  return new Request("http://test.local/api/menus/menu-1/publication", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function menuParams(menuId: string): { params: Promise<{ menuId: string }> } {
  return { params: Promise.resolve({ menuId }) };
}

const PUBLISH_BODY = {};

let ownerId: string;
let restaurantId: string;
const menuId = "menu-1";

function sampleDoc(title: string): MenuDocument {
  return menuDocumentSchema.parse({ ...createSampleMenuDocument(), id: menuId, title });
}

beforeEach(async () => {
  holder.db = await initTestDb();
  const { seedUser } = await import("./helpers/pg-test-db");
  ownerId = await seedUser(holder.db, "pub-api-owner@cafe.test", "Owner");
  restaurantId = (await createRestaurant(holder.db, ownerId, "Café API")).id;
  await createMenuForUser(holder.db, ownerId, restaurantId, sampleDoc("Café API Menu"));
  holder.userId = ownerId;
}, 30_000);

describe("GET /api/menus/[menuId]/publication", () => {
  it("requires a session", async () => {
    holder.userId = null;
    const res = await getPublication(new Request("http://test.local"), menuParams(menuId));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
  });

  it("reports null before the first publish", async () => {
    const res = await getPublication(new Request("http://test.local"), menuParams(menuId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ publication: null });
  });

  it("hides another tenant's menu behind 404", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const outsider = await seedUser(holder.db!, "outsider@cafe.test", "Outsider");
    await createRestaurant(holder.db!, outsider, "Other Café");
    holder.userId = outsider;
    const res = await getPublication(new Request("http://test.local"), menuParams(menuId));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/menus/[menuId]/publication", () => {
  it("publishes and reports ordering live", async () => {
    const res = await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publication).toMatchObject({
      menuId,
      isLive: true,
      hasUnpublishedChanges: false,
    });

    const status = await getPublication(new Request("http://test.local"), menuParams(menuId)).then(
      (r) => r.json()
    );
    expect(status.publication.isLive).toBe(true);

    // The snapshot is what table ordering reads. The address is derived
    // from the menu title and scoped to the café.
    const live = await getPublishedMenuByPath(holder.db!, "cafe-api", "cafe-api-menu");
    expect(live?.doc.id).toBe(menuId);
  });

  it("leaves the live snapshot unchanged until changes are published", async () => {
    await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));

    const current = await getMenuForUser(holder.db!, ownerId, menuId);
    await updateMenuForUser(
      holder.db!,
      ownerId,
      menuId,
      { ...current.doc, title: "Edited after publish" },
      current.updatedAt
    );

    const stale = await getPublication(new Request("http://test.local"), menuParams(menuId)).then(
      (r) => r.json()
    );
    expect(stale.publication.hasUnpublishedChanges).toBe(true);
    expect((await getPublishedMenuByPath(holder.db!, "cafe-api", "cafe-api-menu"))!.doc.title).toBe(
      "Café API Menu"
    );

    const res = await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));
    expect((await res.json()).publication.hasUnpublishedChanges).toBe(false);
    expect((await getPublishedMenuByPath(holder.db!, "cafe-api", "cafe-api-menu"))!.doc.title).toBe(
      "Edited after publish"
    );
  });

  it("rejects bad input and a taken slug", async () => {
    const invalid = await publish(jsonRequest("POST", { slug: "Not A Slug" }), menuParams(menuId));
    expect(invalid.status).toBe(400);

    await publish(jsonRequest("POST", { ...PUBLISH_BODY, slug: "taken" }), menuParams(menuId));

    const secondId = "menu-2";
    await createMenuForUser(holder.db!, ownerId, restaurantId, {
      ...sampleDoc("Second"),
      id: secondId,
    });
    const taken = await publish(
      jsonRequest("POST", { ...PUBLISH_BODY, slug: "taken" }),
      menuParams(secondId)
    );
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe("slug_taken");
  });

  it("refuses staff, who may still read", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const staffId = await seedUser(holder.db!, "pub-api-staff@cafe.test", "Staff");
    await holder.db!.insert(restaurantMembership).values({
      restaurantId,
      userId: staffId,
      role: "staff",
    });
    holder.userId = staffId;
    const res = await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/menus/[menuId]/publication/live", () => {
  it("requires a session and nothing to compare before the first publish", async () => {
    holder.userId = null;
    const signedOut = await getLiveDoc(new Request("http://test.local"), menuParams(menuId));
    expect(signedOut.status).toBe(401);

    holder.userId = ownerId;
    const never = await getLiveDoc(new Request("http://test.local"), menuParams(menuId));
    expect(never.status).toBe(200);
    expect(await never.json()).toEqual({ doc: null });
  });

  it("returns the frozen snapshot, not the edited draft, and 404s other tenants", async () => {
    await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));
    const current = await getMenuForUser(holder.db!, ownerId, menuId);
    await updateMenuForUser(
      holder.db!,
      ownerId,
      menuId,
      { ...current.doc, title: "Edited after publish" },
      current.updatedAt
    );

    const res = await getLiveDoc(new Request("http://test.local"), menuParams(menuId));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).doc.title).toBe("Café API Menu");

    const { seedUser } = await import("./helpers/pg-test-db");
    const outsider = await seedUser(holder.db!, "live-outsider@cafe.test", "Outsider");
    await createRestaurant(holder.db!, outsider, "Other Café");
    holder.userId = outsider;
    const hidden = await getLiveDoc(new Request("http://test.local"), menuParams(menuId));
    expect(hidden.status).toBe(404);
  });
});

describe("DELETE /api/menus/[menuId]/publication", () => {
  it("stops serving while keeping the slug reserved", async () => {
    await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));

    const res = await unpublish(new Request("http://test.local"), menuParams(menuId));
    expect(res.status).toBe(200);
    expect((await res.json()).publication).toMatchObject({ isLive: false });
    expect(await getPublishedMenuByPath(holder.db!, "cafe-api", "cafe-api-menu")).toBeNull();

    // Deleting twice is safe: the second call reports the same unpublished
    // state instead of failing a retry.
    const again = await unpublish(new Request("http://test.local"), menuParams(menuId));
    expect(again.status).toBe(200);
    expect((await again.json()).publication.isLive).toBe(false);
  });
});
