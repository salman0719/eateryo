import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase, DB_NAME } from "../src/features/menu/indexeddb";
import {
  clearDraftOrigin,
  decideHeal,
  getDraftOrigin,
  listDraftOrigins,
  refreshDraftSync,
  stampDraftOrigin,
  visibleMenuIds,
} from "../src/features/menus/draft-origins";

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
    });

    await refreshDraftSync("m1", "user-a", "2026-10-25T10:00:00.000Z");
    expect((await getDraftOrigin("m1"))?.lastSyncedUpdatedAt).toBe("2026-10-25T10:00:00.000Z");
  });

  it("never reassigns a row stamped to someone else", async () => {
    await stampDraftOrigin("m1", "user-a", "s0");

    expect(await stampDraftOrigin("m1", "user-b", "s1")).toEqual({
      menuId: "m1",
      accountId: "user-a",
      lastSyncedUpdatedAt: "s0",
    });
    await refreshDraftSync("m1", "user-b", "s1");
    expect((await getDraftOrigin("m1"))?.accountId).toBe("user-a");

    expect(await listDraftOrigins()).toHaveLength(1);
    await clearDraftOrigin("m1");
    expect(await getDraftOrigin("m1")).toBeUndefined();
  });

  it("keeps the agreed revision when a save carries no new baseline", async () => {
    await stampDraftOrigin("m1", "user-a", "s0");
    await stampDraftOrigin("m1", "user-a", "");
    expect((await getDraftOrigin("m1"))?.lastSyncedUpdatedAt).toBe("s0");
  });
});

describe("decideHeal", () => {
  it("does nothing when the content already agrees", () => {
    expect(
      decideHeal({ contentEqual: true, localUpdatedAt: "t2", lastSyncedUpdatedAt: "s0", serverUpdatedAt: "s1" })
    ).toBe("none");
  });

  it("pushes local work when the server is untouched", () => {
    expect(
      decideHeal({ contentEqual: false, localUpdatedAt: "t2", lastSyncedUpdatedAt: "s0", serverUpdatedAt: "s0" })
    ).toBe("push");
  });

  it("raises a conflict when both sides moved", () => {
    expect(
      decideHeal({ contentEqual: false, localUpdatedAt: "t2", lastSyncedUpdatedAt: "s0", serverUpdatedAt: "s1" })
    ).toBe("conflict");
  });

  it("adopts the server when the browser copy is a stale cache", () => {
    expect(
      decideHeal({ contentEqual: false, localUpdatedAt: "s0", lastSyncedUpdatedAt: "s0", serverUpdatedAt: "s1" })
    ).toBe("adopt");
  });

  it("treats a never-confirmed row with a live server as a conflict, never a silent adopt", () => {
    expect(
      decideHeal({ contentEqual: false, localUpdatedAt: "t1", lastSyncedUpdatedAt: "", serverUpdatedAt: "s1" })
    ).toBe("conflict");
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
