import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LibraryPanel, type LibraryMenu } from "@/components/menu-editor/library-panel";
import type { RestaurantOption } from "@/features/tenancy/client";

/**
 * 001 — the library called account menus "This browser only" for the first
 * network round trip of every load, because an empty id set meant "not read
 * yet" and "not on the account" at the same time. The component boundary owns
 * that contract: without `accountMode` a row names no membership at all, and
 * it never offers to add a menu whose membership is unknown.
 */

function menu(overrides: Partial<LibraryMenu> = {}): LibraryMenu {
  return {
    id: "menu-1",
    title: "Lunch",
    currency: "AUD",
    updatedAt: "2026-10-30T00:00:00.000Z",
    categoryCount: 2,
    itemCount: 6,
    corrupt: false,
    onServer: true,
    ...overrides,
  };
}

const restaurants: RestaurantOption[] = [{ id: "r-1", name: "Corner Café", role: "owner" }];

function render(
  overrides: {
    menus?: LibraryMenu[];
    loading?: boolean;
    accountMode?: boolean;
    withMoveTarget?: boolean;
  } = {}
): string {
  return renderToStaticMarkup(
    createElement(LibraryPanel, {
      menus: overrides.menus ?? [menu()],
      loading: overrides.loading ?? false,
      accountMode: overrides.accountMode ?? false,
      ownedRestaurants: overrides.withMoveTarget ? restaurants : [],
      onMoveToAccount: overrides.withMoveTarget ? async () => null : undefined,
      unavailable: false,
      onOpen: () => {},
      onNew: () => {},
      onRename: () => {},
      onDelete: () => {},
    })
  );
}

describe("LibraryPanel account chips", () => {
  it("says nothing about membership before the account has been read", () => {
    // The bug's first paint: the row exists, the account's list does not yet.
    const html = render({ accountMode: false, menus: [menu({ onServer: true })] });
    expect(html).toContain("Lunch");
    expect(html).not.toContain("On your account");
    expect(html).not.toContain("This browser only");
  });

  it("names the membership a finished read proved", () => {
    const onAccount = render({ accountMode: true, menus: [menu({ onServer: true })] });
    expect(onAccount).toContain("On your account");
    expect(onAccount).not.toContain("This browser only");

    const browserOnly = render({ accountMode: true, menus: [menu({ onServer: false })] });
    expect(browserOnly).toContain("This browser only");
    expect(browserOnly).not.toContain("On your account");
  });

  it("offers the move only to a row the read proved is missing", () => {
    const unknown = render({
      accountMode: false,
      menus: [menu({ onServer: false })],
      withMoveTarget: true,
    });
    expect(unknown).not.toContain("Add to account");

    const missing = render({
      accountMode: true,
      menus: [menu({ onServer: false })],
      withMoveTarget: true,
    });
    expect(missing).toContain("Add to account");

    const present = render({
      accountMode: true,
      menus: [menu({ onServer: true })],
      withMoveTarget: true,
    });
    expect(present).not.toContain("Add to account");
  });
});

describe("LibraryPanel loading", () => {
  it("keeps the skeleton instead of the empty state while the account is read", () => {
    const html = render({ loading: true, menus: [] });
    expect(html).toContain("Loading your menus");
    expect(html).not.toContain("No saved menus yet");
    expect(html).not.toContain("This browser only");
  });
});
