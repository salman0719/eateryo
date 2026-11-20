import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ExtractionResult,
  ReviewFixCard,
  type PreviewMenu,
} from "@/components/upload/extraction-result";

const noop = () => {};

const RESULT: PreviewMenu = {
  title: "Riverside Café — Dinner",
  currency: "$",
  categories: [
    {
      name: "Starters",
      items: [
        {
          name: "Truffle Fires",
          price: 9,
          currency: "$",
          description: null,
          variants: [],
          available: null,
          dietaryLabels: [],
          reviewNotes: ["price partly obscured by shadow"],
        },
        {
          name: "Smashed Avo",
          price: 14,
          currency: "$",
          description: null,
          variants: [],
          available: null,
          dietaryLabels: [],
          reviewNotes: [],
        },
      ],
    },
  ],
};

function render(withRename: boolean) {
  return renderToStaticMarkup(
    createElement(ExtractionResult, {
      data: RESULT,
      source: "ai",
      onStartOver: noop,
      onResolveItem: noop,
      onResolveAll: noop,
      onUpdatePrice: noop,
      onRenameItem: withRename ? noop : undefined,
      onUpdateDescription: noop,
      initialReviewCount: 1,
      previewDoc: null,
    })
  );
}

describe("review inline fixes: fix card", () => {
  const loc = { categoryIndex: 0, itemIndex: 0 };
  const item = RESULT.categories[0].items[0];

  function renderCard(withDescription: boolean) {
    return renderToStaticMarkup(
      createElement(ReviewFixCard, {
        item,
        loc,
        onRenameItem: noop,
        onUpdateDescription: withDescription ? noop : undefined,
      })
    );
  }

  it("edits the name and the description side by side", () => {
    const html = renderCard(true);
    expect(html).toContain("Dish name");
    expect(html).toContain("Description");
    expect(html).toContain("confirm separately");
  });

  it("omits the description field when not wired", () => {
    const html = renderCard(false);
    expect(html).toContain("Dish name");
    expect(html).not.toContain("Description");
  });
});

describe("review inline fixes: rename", () => {
  it("offers a Fix affordance on a flagged row when renaming is wired", () => {
    const html = render(true);
    expect(html).toContain("Fix…");
  });

  it("offers no Fix affordance when renaming is not wired", () => {
    const html = render(false);
    expect(html).not.toContain("Fix…");
  });
});
