import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CategoryHeader } from "../src/components/menu-editor/category-header";
import { addCategory, createMenuDocument, setCategoryCover } from "../src/features/menu/menu-utils";

function setupMenu() {
  let doc = createMenuDocument({ title: "Café" });
  doc = addCategory(doc, { name: "Coffee", description: "Hot drinks, all day." });
  return doc;
}

const sampleCover = {
  url: "https://cdn.example/dish-abc-display.webp",
  key: "dish-abc-display.webp",
  width: 1024,
  height: 640,
  thumb: null,
};

describe("CategoryHeader", () => {
  it("shows the name, description, and cover affordance", () => {
    const doc = setupMenu();
    const html = renderToStaticMarkup(
      createElement(CategoryHeader, {
        doc,
        category: doc.categories[0],
        canUpload: true,
        onChange: () => {},
      })
    );
    expect(html).toContain("Coffee");
    expect(html).toContain("Hot drinks, all day.");
    expect(html).toContain("Add cover photo");
    expect(html).toContain("Shown under the heading on the diner page");
  });

  it("shows the cover photo with replace and remove once set", () => {
    const doc = setupMenu();
    const covered = setCategoryCover(doc, doc.categories[0].id, sampleCover);
    const html = renderToStaticMarkup(
      createElement(CategoryHeader, {
        doc: covered,
        category: covered.categories[0],
        canUpload: true,
        onChange: () => {},
      })
    );
    expect(html).toContain("https://cdn.example/dish-abc-display.webp");
    expect(html).toContain("Replace cover");
    expect(html).toContain("Remove");
  });

  it("offers no upload controls when uploads are unavailable", () => {
    const doc = setupMenu();
    const html = renderToStaticMarkup(
      createElement(CategoryHeader, {
        doc,
        category: doc.categories[0],
        canUpload: false,
        onChange: () => {},
      })
    );
    expect(html).not.toContain("Add cover photo");
    expect(html).toContain("Coffee");
  });
});
