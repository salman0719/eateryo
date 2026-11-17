import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LabelPicker } from "../src/components/menu-editor/label-picker";
import {
  addCategory,
  addItem,
  createMenuDocument,
  setLabelMeaning,
} from "../src/features/menu/menu-utils";

const noop = () => {};

function setupMenu() {
  let doc = createMenuDocument({ title: "Café" });
  doc = addCategory(doc, { name: "Mains" });
  return doc;
}

describe("LabelPicker", () => {
  it("lists the vocabulary with meanings and usage counts", () => {
    let doc = setupMenu();
    doc = addItem(doc, doc.categories[0].id, { name: "Stew", price: 9, dietaryLabels: ["vegan"] });
    doc = setLabelMeaning(doc, "low-alcohol", "Under 1.2% ABV.");
    const html = renderToStaticMarkup(
      createElement(LabelPicker, {
        doc,
        applied: ["vegan"],
        onToggle: noop,
        onAddNew: noop,
        onClose: noop,
      })
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("vegan");
    expect(html).toContain("No animal products.");
    expect(html).toContain("On 1 dish");
    expect(html).toContain("low-alcohol");
    expect(html).toContain("Under 1.2% ABV.");
    expect(html).toContain("Unused starter");
    expect(html).toContain("New label");
  });

  it("says so when a custom code has no explanation yet", () => {
    let doc = setupMenu();
    doc = addItem(doc, doc.categories[0].id, {
      name: "Stew",
      price: 9,
      dietaryLabels: ["mystery"],
    });
    const html = renderToStaticMarkup(
      createElement(LabelPicker, {
        doc,
        applied: [],
        onToggle: noop,
        onAddNew: noop,
        onClose: noop,
      })
    );
    expect(html).toContain("mystery");
    expect(html).toContain("No explanation yet.");
  });
});
