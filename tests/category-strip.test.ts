import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CategoryStrip } from "../src/components/menu-editor/category-strip";

const tabs = [
  { id: "c1", name: "Coffee", dishCount: 12 },
  { id: "c2", name: "Food", dishCount: 7 },
];

function render(overrides: { selectedId?: string | null; query?: string } = {}): string {
  return renderToStaticMarkup(
    createElement(CategoryStrip, {
      tabs,
      selectedId: overrides.selectedId ?? "c1",
      onSelect: () => {},
      query: overrides.query ?? "",
      onQueryChange: () => {},
      searchInputRef: { current: null },
      onAddCategory: () => {},
      matchCount: 2,
      totalItems: 19,
    })
  );
}

describe("CategoryStrip", () => {
  it("names every category with its count and marks exactly one selected", () => {
    const html = render();
    expect(html).toContain("Coffee");
    expect(html).toContain("Food");
    expect(html).toContain(">12<");
    expect(html).toContain(">7<");
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html.indexOf("aria-current")).toBeLessThan(html.indexOf("Food"));
  });

  it("carries the search field, the shortcut, and the add button in the same row", () => {
    const html = render();
    expect(html).toContain('id="menu-search"');
    expect(html).toContain('aria-keyshortcuts="/"');
    expect(html).toContain("+ Category");
    // One wrapping row: the tabs, the field and the button are siblings in it.
    const strip = html.slice(html.indexOf("<nav"), html.indexOf("+ Category"));
    expect(strip).toContain("menu-search");
    expect(strip).not.toContain("Expand all");
  });

  it("shows the match count only while searching", () => {
    expect(render()).not.toContain("matchCount");
    expect(render()).not.toContain("2 of 19");
    expect(render({ query: "lat" })).toContain("2 of 19");
    expect(render({ query: "lat" })).toContain("Clear");
  });
});
