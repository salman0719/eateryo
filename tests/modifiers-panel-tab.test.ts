import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModifiersPanel } from "../src/components/menu-editor/modifiers-panel";
import {
  addModifierTemplate,
  applyModifierTemplate,
} from "../src/features/menu/modifier-templates";
import { addItem, createMenuDocument } from "../src/features/menu/menu-utils";

const noop = () => {};

function docWithSetOnTwoDishes() {
  let doc = createMenuDocument();
  doc.categories.push({
    id: "c1",
    name: "Pizzas",
    sortOrder: 0,
    description: "",
    cover: null,
    items: [],
  });
  doc = addItem(doc, "c1", { name: "Margherita", price: 9 });
  doc = addItem(doc, "c1", { name: "Marinara", price: 8 });
  doc = addModifierTemplate(doc, {
    name: "Pizza sauces",
    min: 0,
    max: 1,
    choices: [{ name: "Extra tomato", priceDelta: 0 }],
  });
  const ids = doc.categories[0].items.map((item) => item.id);
  doc = applyModifierTemplate(doc, "Pizza sauces", ids);
  return doc;
}

describe("ModifiersPanel inline tab", () => {
  it("renders the library with usage counts and no dialog close", () => {
    const html = renderToStaticMarkup(
      createElement(ModifiersPanel, {
        doc: docWithSetOnTwoDishes(),
        canManage: true,
        onChange: noop,
      })
    );
    expect(html).toContain("Add-on sets");
    expect(html).toContain("Pizza sauces");
    expect(html).toContain("on 2 dishes");
    // Inline, not a dialog: no close affordance and no dialog role.
    expect(html).not.toContain("Close add-on sets");
    expect(html).not.toContain('role="dialog"');
  });

  it("invites the owner to define the first set when the library is empty", () => {
    const html = renderToStaticMarkup(
      createElement(ModifiersPanel, {
        doc: createMenuDocument(),
        canManage: true,
        onChange: noop,
      })
    );
    expect(html).toContain("Add-on sets");
    expect(html).toContain("None yet");
  });
});
