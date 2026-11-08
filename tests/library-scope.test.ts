import { describe, expect, it } from "vitest";

import { scopeMenusToCafe } from "@/features/menus/library-scope";

const cafes = new Map([
  ["menu-own", "r-own"],
  ["menu-shift", "r-shift"],
]);

function scope(overrides: Partial<Parameters<typeof scopeMenusToCafe>[0]> = {}) {
  return scopeMenusToCafe({
    menuIds: ["menu-own", "menu-shift", "draft-local"],
    restaurantById: cafes,
    restaurantId: "r-own",
    canWrite: true,
    known: true,
    ...overrides,
  });
}

describe("scopeMenusToCafe", () => {
  it("lists only the active café's server menus", () => {
    expect(scope()).toEqual(["menu-own", "draft-local"]);
    expect(scope({ restaurantId: "r-shift" })).toEqual(["menu-shift", "draft-local"]);
  });

  it("keeps browser-only drafts where the membership can write", () => {
    expect(scope({ canWrite: false })).toEqual(["menu-own"]);
    expect(scope({ restaurantId: "r-shift", canWrite: false })).toEqual(["menu-shift"]);
  });

  it("keeps a new account's drafts when it has no café yet", () => {
    expect(scope({ restaurantId: null, menuIds: ["draft-local"] })).toEqual([
      "draft-local",
    ]);
    // A server row without an active café is not this context's row.
    expect(scope({ restaurantId: null })).toEqual(["draft-local"]);
  });

  it("hides nothing while the account read has not answered", () => {
    expect(scope({ known: false, restaurantId: "r-shift", canWrite: false })).toEqual([
      "menu-own",
      "menu-shift",
      "draft-local",
    ]);
  });
});