import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase, DB_NAME } from "../src/features/menu/indexeddb";
import {
  clearDraftOrigin,
  decideHeal,
  getDraftOrigin,
  listDraftOrigins,
  menuContentHash,
  refreshDraftSync,
  stampClaimedMenus,
  stampDraftOrigin,
  visibleMenuIds,
} from "../src/features/menus/draft-origins";
import { createMenuDocument } from "../src/features/menu/menu-utils";

function resetDatabase(): Promise<void> {
  closeDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

beforeEach(() => resetDatabase());
afterEach(() => closeDatabase());

describe("draft origins", () => {
  it("stamps a new row and refreshes the agreed revision", async () => {
    await stampDraftOrigin("m1", "user-a", "");
    expect(await getDraftOrigin("m1")).toEqual({
      menuId: "m1",
      accountId: "user-a",
      lastSyncedUpdatedAt: "",
      lastSyncedHash: "",
    });

    await refreshDraftSync("m1", "user-a", "2026-10-25T10:00:00.000Z", "abc123");
    expect((await getDraftOrigin("m1"))?.lastSyncedUpdatedAt).toBe("2026-10-25T10:00:00.000Z");
    expect((await getDraftOrigin("m1"))?.lastSyncedHash).toBe("abc123");
  });

  it("never reassigns a row stamped to someone else", async () => {
    await stampDraftOrigin("m1", "user-a", "s0", "h0");

    expect(await stampDraftOrigin("m1", "user-b", "s1")).toEqual({
      menuId: "m1",
      accountId: "user-a",
      lastSyncedUpdatedAt: "s0",
      lastSyncedHash: "h0",
    });
    await refreshDraftSync("m1", "user-b", "s1");
    expect((await getDraftOrigin("m1"))?.accountId).toBe("user-a");

    expect(await listDraftOrigins()).toHaveLength(1);
    await clearDraftOrigin("m1");
    expect(await getDraftOrigin("m1")).toBeUndefined();
  });

  it("keeps the agreed revision when a save carries no new baseline", async () => {
    await stampDraftOrigin("m1", "user-a", "s0", "h0");
    await stampDraftOrigin("m1", "user-a", "");
    expect((await getDraftOrigin("m1"))?.lastSyncedUpdatedAt).toBe("s0");
    expect((await getDraftOrigin("m1"))?.lastSyncedHash).toBe("h0");
  });

  it("hashes content identically regardless of key order", () => {
    const doc = createMenuDocument({ title: "Café" });
    const reordered = JSON.parse(
      JSON.stringify({ updatedAt: doc.updatedAt, currency: doc.currency, title: doc.title, id: doc.id, categories: doc.categories })
    );
    expect(menuContentHash({ ...doc, id: reordered.id })).toBe(
      menuContentHash({ ...doc, ...reordered })
    );
    expect(menuContentHash({ ...doc, title: "Changed" })).not.toBe(menuContentHash(doc));
  });
});

describe("decideHeal", () => {
  const hashed = {
    localHash: "local",
    serverHash: "server",
    lastSyncedHash: "agreed",
  };

  it("does nothing when the content already agrees", () => {
    expect(
      decideHeal({ contentEqual: true, localUpdatedAt: "t2", lastSyncedUpdatedAt: "s0", serverUpdatedAt: "s1", ...hashed })
    ).toBe("none");
  });

  it("pushes local work when the server is untouched", () => {
    expect(
      decideHeal({ contentEqual: false, localUpdatedAt: "t2", lastSyncedUpdatedAt: "s0", serverUpdatedAt: "s0", ...hashed })
    ).toBe("push");
  });

  it("raises a conflict when both sides moved", () => {
    expect(
      decideHeal({ contentEqual: false, localUpdatedAt: "t2", lastSyncedUpdatedAt: "s0", serverUpdatedAt: "s1", ...hashed })
    ).toBe("conflict");
  });

  it("adopts the server when the browser copy is exactly what was agreed", () => {
    expect(
      decideHeal({
        contentEqual: false,
        localUpdatedAt: "s0",
        lastSyncedUpdatedAt: "s0",
        serverUpdatedAt: "s1",
        localHash: "agreed",
        serverHash: "server",
        lastSyncedHash: "agreed",
      })
    ).toBe("adopt");
  });

  it("adopts without trusting timestamps when the local copy is untouched", () => {
    // Clock skew or a restamped save must not turn a stale cache into a push.
    expect(
      decideHeal({
        contentEqual: false,
        localUpdatedAt: "t9",
        lastSyncedUpdatedAt: "s0",
        serverUpdatedAt: "s1",
        localHash: "agreed",
        serverHash: "server",
        lastSyncedHash: "agreed",
      })
    ).toBe("adopt");
  });

  it("pushes by hash when the server matches the agreement but the stamp has no timestamp", () => {
    expect(
      decideHeal({
        contentEqual: false,
        localUpdatedAt: "t2",
        lastSyncedUpdatedAt: "",
        serverUpdatedAt: "s1",
        localHash: "local",
        serverHash: "agreed",
        lastSyncedHash: "agreed",
      })
    ).toBe("push");
  });

  it("conflicts by hash when both sides left the agreement", () => {
    expect(
      decideHeal({
        contentEqual: false,
        localUpdatedAt: "t2",
        lastSyncedUpdatedAt: "",
        serverUpdatedAt: "s1",
        localHash: "local",
        serverHash: "server",
        lastSyncedHash: "agreed",
      })
    ).toBe("conflict");
  });

  it("treats a never-confirmed row with a live server as a conflict, never a silent adopt", () => {
    expect(
      decideHeal({
        contentEqual: false,
        localUpdatedAt: "t1",
        lastSyncedUpdatedAt: "",
        serverUpdatedAt: "s1",
        localHash: "local",
        serverHash: "server",
        lastSyncedHash: "",
      })
    ).toBe("conflict");
  });
});

describe("stampClaimedMenus", () => {
  const doc = (id: string, title: string) => ({
    ...createMenuDocument({ title }),
    id,
  });

  it("stamps imported rows with the uploaded content hash, no baseline", async () => {
    const docs: Record<string, ReturnType<typeof doc>> = {
      m1: doc("m1", "Lunch"),
      m2: doc("m2", "Drinks"),
    };
    await stampClaimedMenus(["m1", "m2"], "user-a", async (id) => docs[id]!);
    for (const id of ["m1", "m2"]) {
      const origin = await getDraftOrigin(id);
      expect(origin?.accountId).toBe("user-a");
      expect(origin?.lastSyncedUpdatedAt).toBe("");
      expect(origin?.lastSyncedHash).toBe(menuContentHash(docs[id]!));
    }
  });

  it("skips unreadable rows without blocking the rest", async () => {
    const docs: Record<string, ReturnType<typeof doc>> = { m1: doc("m1", "Lunch") };
    await stampClaimedMenus(["m1", "missing"], "user-a", async (id) => {
      const found = docs[id];
      if (!found) throw new Error("not here");
      return found;
    });
    expect((await getDraftOrigin("m1"))?.accountId).toBe("user-a");
    expect(await getDraftOrigin("missing")).toBeUndefined();
  });

  it("never reassigns another account's stamp at claim time", async () => {
    await stampDraftOrigin("m1", "user-a", "s0", "h0");
    await stampClaimedMenus(["m1"], "user-b", async () => doc("m1", "Changed"));
    expect(await getDraftOrigin("m1")).toEqual({
      menuId: "m1",
      accountId: "user-a",
      lastSyncedUpdatedAt: "s0",
      lastSyncedHash: "h0",
    });
  });
});

describe("visibleMenuIds", () => {
  const ids = ["anon", "mine", "theirs"];
  const origins = [
    { menuId: "mine", accountId: "user-a" },
    { menuId: "theirs", accountId: "user-b" },
  ];

  it("shows anonymous rows to everyone, stamped rows only to their owner", () => {
    expect(visibleMenuIds(ids, origins, "user-a")).toEqual(["anon", "mine"]);
    expect(visibleMenuIds(ids, origins, "user-b")).toEqual(["anon", "theirs"]);
  });

  it("hides every stamped row when signed out", () => {
    expect(visibleMenuIds(ids, origins, null)).toEqual(["anon"]);
  });
});
