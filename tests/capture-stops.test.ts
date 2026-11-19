import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CapturePage, type CaptureView } from "@/components/pages/capture-page";
import type { PageImage } from "@/components/upload/image-preview";
import type { PreviewMenu } from "@/components/upload/extraction-result";

const noop = () => {};

const RESULT: PreviewMenu = {
  title: "Earl’s",
  currency: "£",
  categories: [
    {
      name: "Mains",
      items: [
        {
          name: "Chicken milanese",
          price: 14.5,
          currency: "£",
          description: "Lemon",
          variants: [],
          available: true,
          dietaryLabels: [],
          reviewNotes: [],
        },
        {
          name: "Market fish",
          price: null,
          currency: "£",
          description: null,
          variants: [],
          available: null,
          dietaryLabels: [],
          reviewNotes: ["no price on the page"],
        },
      ],
    },
  ],
};

const PAGES: PageImage[] = [
  { file: { name: "page-1.jpg", size: 1024 } as unknown as File, previewUrl: "blob:page-1" },
];

function render(
  overrides: {
    view?: CaptureView;
    result?: PreviewMenu | null;
    pages?: PageImage[];
    publishSlot?: ReactNode;
  } = {}
) {
  return renderToStaticMarkup(
    createElement(CapturePage, {
      signedIn: true,
      sessionPending: false,
      view: overrides.view ?? "capture",
      onViewChange: noop,
      publishSlot: overrides.publishSlot ?? null,
      phase: "done",
      pages: overrides.pages ?? PAGES,
      fileError: null,
      addInputRef: { current: null },
      replaceInputRef: { current: null },
      replaceIndexRef: { current: null },
      resultRef: { current: null },
      onSelectFiles: noop,
      onDemo: noop,
      onAddPages: noop,
      onReplacePageAt: noop,
      onRemovePage: noop,
      onExtract: noop,
      extractProgress: null,
      extractError: null,
      result: overrides.result === undefined ? RESULT : overrides.result,
      previewDoc: null,
      source: "ai",
      draftSave: "saved",
      draftOnServer: false,
      initialReviewCount: 1,
      onClear: noop,
      onEdit: noop,
      onResolveItem: noop,
      onResolveAll: noop,
      onUpdatePrice: noop,
      onRenameTitle: noop,
      onPublish: undefined,
    })
  );
}

describe("capture stops", () => {
  it("renders only the work stop: pages, the read summary and the guarded re-read", () => {
    const html = render();
    expect(html).toContain("Read 2 dishes in 1 category");
    expect(html).toContain("Extract again");
    expect(html).toContain("Continue to review →");
    // The review surface is not on screen at the same time.
    expect(html).not.toContain("Check what the AI read");
    expect(html).not.toContain("Check this");
  });

  it("renders only the review stop when review is open", () => {
    const html = render({ view: "review" });
    expect(html).toContain("Check what the AI read");
    expect(html).toContain("Check this");
    expect(html).toContain("Market fish");
    // No upload field or extract action stacked under the review.
    expect(html).not.toContain("Extract again");
    expect(html).not.toContain("Extract menu");
  });

  it("falls back to the work stop when review has nothing to show", () => {
    const html = render({ view: "review", result: null });
    expect(html).not.toContain("Check what the AI read");
    expect(html).toContain("Extract menu");
  });

  it("keeps the read summary for a resumed draft whose photo is gone", () => {
    const html = render({ pages: [] });
    expect(html).toContain("Read 2 dishes in 1 category");
    expect(html).toContain("Continue to review →");
    // Nothing to re-read without pages, so no second paid call is offered.
    expect(html).not.toContain("Extract again");
  });

  it("shows Publish as a stop but does not open it before there is a draft", () => {
    const html = render();
    expect(html).toContain("Publish");
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });

  it("renders the publish stop in place of the review once the shell mounts it", () => {
    const html = render({
      view: "publish",
      publishSlot: createElement("p", null, "Publish my menu"),
    });
    expect(html).toContain("Publish my menu");
    expect(html).not.toContain("Check what the AI read");
    expect(html).not.toContain("Extract again");
    // Every stop is now reachable, so none of them is disabled.
    expect(html).not.toContain('disabled=""');
  });

  it("does not open the publish stop when there is no wizard to mount", () => {
    const html = render({ view: "publish" });
    // Back to the work stop, which still holds the read.
    expect(html).toContain("Read 2 dishes in 1 category");
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });
});
