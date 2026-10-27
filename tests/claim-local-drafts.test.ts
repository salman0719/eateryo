import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decideLocalDraftClaim,
  dismissLocalDraftClaim,
  loadBrowserAccount,
  loadLocalDraftClaim,
  localDraftClaimKey,
  markLocalDraftsClaimed,
  rememberBrowserAccount,
} from "@/features/menus/claim-local-drafts";

/**
 * R1 claim rules: a brand-new account auto-imports its browser drafts, an
 * established account is offered them, and a remembered answer (done or
 * "not now") stops both. Storage failures must never lose a draft.
 */

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  } as Storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const NEW_ACCOUNT = {
  localCount: 2,
  accountMenuCount: 0,
  restaurantCount: 0,
  ownedRestaurantCount: 0,
  status: "unseen" as const,
};

describe("decideLocalDraftClaim", () => {
  it("auto-imports for a brand-new account", () => {
    expect(decideLocalDraftClaim(NEW_ACCOUNT)).toBe("auto-import");
  });

  it("does nothing without browser-only menus", () => {
    expect(decideLocalDraftClaim({ ...NEW_ACCOUNT, localCount: 0 })).toBe("none");
  });

  it("offers the import once the account already has menus", () => {
    expect(
      decideLocalDraftClaim({
        ...NEW_ACCOUNT,
        accountMenuCount: 3,
        restaurantCount: 1,
        ownedRestaurantCount: 1,
      })
    ).toBe("offer");
  });

  it("auto-imports when the account holds no menus, even with a restaurant", () => {
    expect(
      decideLocalDraftClaim({ ...NEW_ACCOUNT, restaurantCount: 1, ownedRestaurantCount: 1 })
    ).toBe("auto-import");
  });

  it("stays quiet for staff-only accounts, who have nowhere to import", () => {
    expect(
      decideLocalDraftClaim({
        ...NEW_ACCOUNT,
        accountMenuCount: 4,
        restaurantCount: 1,
        ownedRestaurantCount: 0,
      })
    ).toBe("none");
  });

  it("honours a remembered dismissal or completion", () => {
    expect(decideLocalDraftClaim({ ...NEW_ACCOUNT, status: "dismissed" })).toBe("none");
    expect(decideLocalDraftClaim({ ...NEW_ACCOUNT, status: "done" })).toBe("none");
  });

  it("swallows the browser on a shared device: whoever signs in owns what was there", () => {
    // No fork, no queue — the first sign-in adopts the drafts, marked so
    // they never render signed out again.
    expect(decideLocalDraftClaim(NEW_ACCOUNT)).toBe("auto-import");
  });
});

describe("per-account memory", () => {
  it("remembers done and dismissed independently per account", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    expect(loadLocalDraftClaim("user-a")).toBe("unseen");
    dismissLocalDraftClaim("user-a");
    expect(loadLocalDraftClaim("user-a")).toBe("dismissed");
    expect(loadLocalDraftClaim("user-b")).toBe("unseen");

    markLocalDraftsClaimed("user-b");
    expect(loadLocalDraftClaim("user-b")).toBe("done");
    expect(storage.getItem(localDraftClaimKey("user-b"))).toBe("done");
  });

  it("treats damaged values and unavailable storage as unseen", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    storage.setItem(localDraftClaimKey("user-a"), "maybe");
    expect(loadLocalDraftClaim("user-a")).toBe("unseen");

    vi.stubGlobal("window", {});
    expect(loadLocalDraftClaim("user-a")).toBe("unseen");
    expect(() => markLocalDraftsClaimed("user-a")).not.toThrow();
    expect(() => dismissLocalDraftClaim("user-a")).not.toThrow();
  });

  it("remembers which account this browser was last used with", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    expect(loadBrowserAccount()).toBeNull();
    rememberBrowserAccount("user-a");
    expect(loadBrowserAccount()).toBe("user-a");
  });

  it("never throws when storage itself rejects the write", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });

    expect(loadLocalDraftClaim("user-a")).toBe("unseen");
    expect(() => markLocalDraftsClaimed("user-a")).not.toThrow();
    expect(() => dismissLocalDraftClaim("user-a")).not.toThrow();
  });
});
