import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CategoryPills, SearchResultsList } from "../src/components/menu-editor/category-pills";
import { addCategory, addItem, createMenuDocument } from "../src/features/menu/menu-utils";
import { flatSearchRows } from "../src/features/menu/search";

function setupMenu() {
  let doc = createMenuDocument({ title: "Café" });
  doc = addCategory(doc, { name: "Coffee" });
  doc = addCategory(doc, { name: "Food" });
  const [coffeeId] = doc.categories.map((c) => c.id);
  doc = addItem(doc, coffeeId, { name: "Espresso", price: 3 });
  doc = addItem(doc, coffeeId, { name: "Latte", price: 4, description: "Double shot milk" });
  return doc;
}

describe("CategoryPills", () => {
  it("names every category with its dish count and marks the open one", () => {
    const doc = setupMenu();
    const html = renderToStaticMarkup(
      createElement(CategoryPills, {
        pills: doc.categories.map((category, index) => ({
          id: category.id,
          name: category.name,
          dishCount: category.items.length,
          open: index === 0,
        })),
        onSelect: () => {},
      })
    );
    expect(html).toContain("Coffee");
    expect(html).toContain("Food");
    expect(html.match(/aria-pressed=\"true\"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed=\"false\"/g)).toHaveLength(1);
  });

  it("renders nothing without categories", () => {
    const html = renderToStaticMarkup(
      createElement(CategoryPills, { pills: [], onSelect: () => {} })
    );
    expect(html).toBe("");
  });
});

describe("SearchResultsList", () => {
  it("renders one flat row per match with price and category pill", () => {
    const doc = setupMenu();
    const rows = flatSearchRows(doc, "e");
    const html = renderToStaticMarkup(
      createElement(SearchResultsList, { rows, currency: "$", onPick: () => {} })
    );
    expect(html).toContain("Espresso");
    expect(html).toContain("Latte");
    expect(html).toContain("Coffee");
    expect(html).toContain("$ 3.00");
  });

  it("says so honestly when nothing matches", () => {
    const html = renderToStaticMarkup(
      createElement(SearchResultsList, { rows: [], currency: null, onPick: () => {} })
    );
    expect(html).toContain("No dishes match");
  });
});
