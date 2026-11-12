import { describe, expect, it } from "vitest";

import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import {
  docForRoutedMenu,
  forgetPendingNewMenu,
  isPendingNewMenu,
  rememberPendingNewMenu,
} from "@/features/menus/routed-doc";

/**
 * Entering a second menu painted the first one until its own copy was read:
 * leaving the editor for the library keeps the document in memory, and the
 * editor rendered whatever was in memory. This is the rule that makes that
 * impossible — only the menu the URL names may ever be rendered.
 */

describe("docForRoutedMenu", () => {
  const first = createSampleMenuDocument();
  const second = createSampleMenuDocument();

  it("renders the menu the URL names", () => {
    expect(docForRoutedMenu(first, { screen: "editor", menuId: first.id, mode: "edit" })).toBe(
      first
    );
  });

  it("never renders a document left over from a different menu", () => {
    // The regression: the first menu is still in memory while the second one
    // loads, and it must not stand in for it.
    expect(first.id).not.toBe(second.id);
    expect(
      docForRoutedMenu(first, { screen: "editor", menuId: second.id, mode: "edit" })
    ).toBeNull();
  });

  it("keeps the same menu across its modes and an item deep link", () => {
    expect(docForRoutedMenu(first, { screen: "editor", menuId: first.id, mode: "publish" })).toBe(
      first
    );
    expect(docForRoutedMenu(first, { screen: "item", menuId: first.id, itemId: "item-1" })).toBe(
      first
    );
  });

  it("never mistakes one fresh menu for another", () => {
    const store = new Map<string, string>();
    const backing = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    // Server render (or private mode): no store means no marker, never a crash.
    expect(isPendingNewMenu("menu-1", null)).toBe(false);
    rememberPendingNewMenu("menu-1", null);
    expect(isPendingNewMenu("menu-1", null)).toBe(false);

    rememberPendingNewMenu("menu-1", backing);
    expect(isPendingNewMenu("menu-1", backing)).toBe(true);
    expect(isPendingNewMenu("menu-2", backing)).toBe(false);
    // Forgetting a different id leaves the marker alone.
    forgetPendingNewMenu("menu-2", backing);
    expect(isPendingNewMenu("menu-1", backing)).toBe(true);
    forgetPendingNewMenu("menu-1", backing);
    expect(isPendingNewMenu("menu-1", backing)).toBe(false);
  });

  it("renders nothing once the route leaves the editor", () => {
    // Back in the library the document may stay cached, but nothing renders
    // it there either.
    expect(docForRoutedMenu(first, { screen: "library" })).toBeNull();
    expect(docForRoutedMenu(first, { screen: "capture" })).toBeNull();
    expect(docForRoutedMenu(null, { screen: "editor", menuId: first.id, mode: "edit" })).toBeNull();
  });
});
