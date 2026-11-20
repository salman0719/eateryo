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
      onUpdateVariants: noop,
      onMoveItem: noop,
      onDeleteItem: noop,
      onAddItem: noop,
      initialReviewCount: 1,
      previewDoc: null,
    })
  );
}

describe("review inline fixes: fix card", () => {
  const loc = { categoryIndex: 0, itemIndex: 0 };
  const item = RESULT.categories[0].items[0];

  function renderCard(
    options: { description?: boolean; variants?: boolean; move?: boolean; del?: boolean } = {}
  ) {
    return renderToStaticMarkup(
      createElement(ReviewFixCard, {
        item,
        loc,
        onRenameItem: noop,
        onUpdateDescription: options.description ? noop : undefined,
        onUpdateVariants: options.variants ? noop : undefined,
        categoryNames: options.move ? ["Starters", "Mains"] : undefined,
        currentCategoryIndex: options.move ? 0 : undefined,
        onMoveItem: options.move ? noop : undefined,
        onDeleteItem: options.del ? noop : undefined,
      })
    );
  }

  it("edits the name and the description side by side", () => {
    const html = renderCard({ description: true });
    expect(html).toContain("Dish name");
    expect(html).toContain("Description");
    expect(html).toContain("confirm separately");
  });

  it("omits the description field when not wired", () => {
    const html = renderCard();
    expect(html).toContain("Dish name");
    expect(html).not.toContain("Description");
  });

  it("edits per-size prices with an add-size path when wired", () => {
    const sized = {
      ...item,
      price: null,
      variants: [
        { name: "S", price: 11 },
        { name: "M", price: null },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(ReviewFixCard, {
        item: sized,
        loc,
        onRenameItem: noop,
        onUpdateVariants: noop,
      })
    );
    expect(html).toContain("Sizes");
    expect(html).toContain("+ Add size");
  });

  it("omits the sizes section when not wired", () => {
    const html = renderCard({ description: true });
    expect(html).not.toContain("Sizes");
  });

  it("moves a dish to another category, excluding its own", () => {
    const html = renderCard({ move: true });
    expect(html).toContain("Move to");
    expect(html).toContain("Mains");
  });

  it("deletes a dish from the card when wired", () => {
    const html = renderCard({ del: true });
    expect(html).toContain("Delete dish");
    expect(renderCard()).not.toContain("Delete dish");
  });

  it("adds a dish the AI missed per category when wired", () => {
    const html = renderToStaticMarkup(
      createElement(ExtractionResult, {
        data: RESULT,
        source: "ai",
        onStartOver: noop,
        onResolveItem: noop,
        onResolveAll: noop,
        onUpdatePrice: noop,
        onRenameItem: noop,
        onUpdateDescription: noop,
        onUpdateVariants: noop,
        onMoveItem: noop,
        onDeleteItem: noop,
        onAddItem: noop,
        initialReviewCount: 1,
        previewDoc: null,
      })
    );
    expect(html).toContain("Add a dish the AI missed");
  });

  it("omits the move list with a single category or when not wired", () => {
    expect(renderCard()).not.toContain("Move to");
    const single = renderToStaticMarkup(
      createElement(ReviewFixCard, {
        item,
        loc,
        onRenameItem: noop,
        categoryNames: ["Starters"],
        currentCategoryIndex: 0,
        onMoveItem: noop,
      })
    );
    expect(single).not.toContain("Move to");
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

  it("offers Edit on Ready rows too: confidence is not trust", () => {
    const html = render(true);
    expect(html).toContain("Edit…");
    expect(render(false)).not.toContain("Edit…");
  });
});
