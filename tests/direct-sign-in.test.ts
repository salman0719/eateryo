import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearDirectSignInIntent,
  loadDirectSignInIntent,
  saveDirectSignInIntent,
} from "@/features/menus/direct-sign-in";

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

describe("direct sign-in intent", () => {
  it("round-trips an attach decision with its menu ids", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    saveDirectSignInIntent({ decision: "attach", menuIds: ["menu-1"] });
    expect(loadDirectSignInIntent()).toEqual({ decision: "attach", menuIds: ["menu-1"] });
  });

  it("round-trips a discard decision", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    saveDirectSignInIntent({ decision: "discard", menuIds: ["menu-1"] });
    expect(loadDirectSignInIntent()?.decision).toBe("discard");
  });

  it("clears the intent once consumed", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    saveDirectSignInIntent({ decision: "attach", menuIds: ["menu-1"] });
    clearDirectSignInIntent();
    expect(loadDirectSignInIntent()).toBeNull();
  });

  it("ignores a damaged or foreign blob instead of acting on it", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    storage.setItem("eateryo:direct-signin-intent", "not-json");
    expect(loadDirectSignInIntent()).toBeNull();
    storage.setItem(
      "eateryo:direct-signin-intent",
      JSON.stringify({ decision: "explode", menuIds: ["menu-1"] })
    );
    expect(loadDirectSignInIntent()).toBeNull();
    storage.setItem(
      "eateryo:direct-signin-intent",
      JSON.stringify({ decision: "attach", menuIds: ["menu-1", 42, ""] })
    );
    expect(loadDirectSignInIntent()).toEqual({ decision: "attach", menuIds: ["menu-1"] });
  });

  it("is empty without storage or without a choice", () => {
    vi.stubGlobal("window", undefined);
    expect(loadDirectSignInIntent()).toBeNull();
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    expect(loadDirectSignInIntent()).toBeNull();
  });
});
