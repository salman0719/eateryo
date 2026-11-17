import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DuplicateReview } from "../src/components/menu-editor/duplicate-review";
import { findDuplicateGroups } from "../src/features/menu/duplicates";
import { addItem, createMenuDocument } from "../src/features/menu/menu-utils";

const noop = () => {};

function docWithDupes() {
  let doc = createMenuDocument();
  for (const [id, name] of [
    ["c1", "Mains"],
    ["c2", "Starters"],
  ] as const) {
    doc.categories.push({
      id,
      name,
      sortOrder: 0,
      description: "",
      cover: null,
      items: [],
    });
  }
  doc = addItem(doc, "c1", { name: "Soup", price: 5 });
  doc = addItem(doc, "c2", { name: "soup ", price: null });
  return doc;
}

describe("DuplicateReview", () => {
  it("renders nothing when there are no groups", () => {
    const html = renderToStaticMarkup(
      createElement(DuplicateReview, {
        groups: [],
        currency: "USD",
        onKeepGroup: noop,
        onDeleteCopy: noop,
      })
    );
    expect(html).toBe("");
  });

  it("reviews one group with keep-all and delete-this-copy actions", () => {
    const groups = findDuplicateGroups(docWithDupes());
    expect(groups).toHaveLength(1);
    const html = renderToStaticMarkup(
      createElement(DuplicateReview, {
        groups,
        currency: "USD",
        onKeepGroup: noop,
        onDeleteCopy: noop,
      })
    );
    expect(html).toContain("1 possible duplicate found");
    expect(html).toContain("nothing is deleted automatically");
    expect(html).toContain("Soup");
    expect(html).toContain("in Mains");
    expect(html).toContain("in Starters");
    expect(html).toContain("Keep all");
    expect(html).toContain("Delete this copy");
  });

  it("counts several groups in the heading", () => {
    let doc = docWithDupes();
    doc = addItem(doc, "c1", { name: "Bread", price: 2 });
    doc = addItem(doc, "c2", { name: "bread", price: 2 });
    const groups = findDuplicateGroups(doc);
    expect(groups).toHaveLength(2);
    const html = renderToStaticMarkup(
      createElement(DuplicateReview, {
        groups,
        currency: "USD",
        onKeepGroup: noop,
        onDeleteCopy: noop,
      })
    );
    expect(html).toContain("2 possible duplicates found");
  });
});
