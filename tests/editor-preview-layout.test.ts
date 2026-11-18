import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MenuEditor } from "@/components/menu-editor/menu-editor";
import type { PublishingControls } from "@/components/menu-editor/publish-panel";
import type { MenuDocument } from "@/features/menu/schema";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";

/**
 * The preview tab's layout: from `lg` the page and its publish state sit side
 * by side (sticky rail, centred as one cluster, page capped at a phone's
 * width); on a phone the card stacks above the page.
 *
 * The card is the only publish surface at either width — no compact summary
 * above it — and its two actions share one row, pinned to opposite edges.
 */

const liveWithChanges: PublishingControls = {
  status: {
    menuId: "menu-1",
    restaurantId: "restaurant-1",
    isLive: true,
    publishedAt: "2026-11-01T20:20:50.100Z",
    liveRevisionId: "revision-1",
    sourceUpdatedAt: "2026-11-01T20:20:50.100Z",
    hasUnpublishedChanges: true,
  },
  loaded: true,
  busy: false,
  error: null,
  inAccount: true,
  liveDoc: null,
  liveDocState: "idle",
  onPublish: () => {},
  onUnpublish: () => {},
};

/**
 * A live menu and a draft that repriced one dish and moved one add-on price,
 * by id — one adjective count and one noun count.
 */
function repricedPair(): { live: MenuDocument; draft: MenuDocument } {
  const live = createSampleMenuDocument();
  const draft = structuredClone(live);
  const item = draft.categories[0]?.items[0];
  if (item) item.price = (item.price ?? 0) + 1;
  const choice = draft.categories[0]?.items[1]?.options[0]?.choices[0];
  if (choice) choice.priceDelta = (choice.priceDelta ?? 0) + 1;
  return { live, draft };
}

function renderPreview(options: {
  canManage: boolean;
  publishing?: PublishingControls;
  doc?: MenuDocument;
  signedIn?: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(MenuEditor, {
      doc: options.doc ?? createSampleMenuDocument(),
      mode: "preview",
      onModeChange: () => {},
      onChange: () => {},
      saveState: { kind: "saved", message: "Saved" },
      syncMode: options.signedIn === false ? "local" : "account",
      imageUrl: null,
      onExportJson: () => {},
      onExportCsv: () => {},
      onImportFile: () => {},
      importError: null,
      onDeleteMenu: () => {},
      canManage: options.canManage,
      publishing: options.publishing,
      onStartPublish: () => {},
    })
  );
}

describe("preview tab layout", () => {
  it("puts the page and its publish card side by side, stacked below lg", () => {
    const html = renderPreview({ canManage: true, publishing: liveWithChanges });

    // The two-column grid only exists at `lg`; below it the flex column stacks.
    // The pair is centred as one cluster, so neither edge claims a gutter.
    // The page keeps the wider track at lg: a 340px card beside a 335px
    // phone made the card the larger of the two. The rail widens at xl.
    expect(html).toContain("lg:grid-cols-[minmax(0,420px)_320px]");
    expect(html).toContain("xl:grid-cols-[minmax(0,420px)_340px]");
    expect(html).toContain("lg:justify-center");
    expect(html).toContain("lg:items-start");
    // Stacked order: the publish card first, the page under it.
    expect(html).toContain("order-1");
    expect(html).toContain("order-2");
    expect(html).toContain("lg:order-none");
    // The rail sticks while the page scrolls, and the frame stays a phone:
    // one capped width, whatever the window.
    expect(html).toContain("lg:sticky");
    expect(html).toContain("max-w-[420px]");
    expect(html).not.toContain("520px");
  });

  it("renders one publish card, with both actions on one row", () => {
    const { live, draft } = repricedPair();
    const html = renderPreview({
      canManage: true,
      doc: draft,
      publishing: { ...liveWithChanges, liveDoc: live, liveDocState: "ready" },
    });

    // No compact summary above the card: the card is the surface, and its
    // change list is the only disclosure — one of it.
    expect(html.match(/>Show details</g)).toHaveLength(1);
    // Shut it offers the list, open it offers the way back; the <details>
    // element's own state swaps them, so no state can drift from the markup.
    expect(html).toContain('group-open:hidden">Show details');
    expect(html).toContain('hidden group-open:inline">Hide details');
    expect(html).toContain("Since you last published: 1 repriced · 1 option");
    // A count of one gets a singular noun.
    expect(html).not.toContain("1 options");
    // Unpublish then the primary, the primary pushed to the far edge. Match
    // the buttons, not the prose that quotes the same words.
    const unpublish = html.indexOf(">Unpublish</button>");
    const publish = html.indexOf(">Publish changes</button>");
    expect(unpublish).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(unpublish);
    expect(html).toContain("ml-auto");
    // Neither button may shrink into a narrower box or wrap its label: at
    // 320px the pair has to stay on one line.
    const actionRow = html.slice(unpublish - 400, publish + 400);
    expect(actionRow.match(/shrink-0/g)).toHaveLength(2);
    expect(actionRow.match(/whitespace-nowrap/g)).toHaveLength(2);
    expect(html).toContain("justify-between");
  });

  it("offers only the publish action for a menu that was never published", () => {
    const html = renderPreview({
      canManage: true,
      publishing: { ...liveWithChanges, status: null, liveDoc: null },
    });

    expect(html).toContain("Not published");
    expect(html).toContain("Publish for ordering");
    // Nothing is live, so there is nothing to unpublish.
    expect(html).not.toContain("Unpublish this menu");
  });

  it("keeps the caution with the page instead of describing the rail", () => {
    const html = renderPreview({ canManage: true, publishing: liveWithChanges });

    // The banner belongs to the diner page at every width — on a phone the
    // card is *above* the page, so any “beside this rail” would be false.
    expect(html).toContain("This is the page a table card opens");
    expect(html).not.toContain("beside this rail");
    expect(html).not.toContain("This preview");
  });

  it("leaves a staff preview alone, with the in-page banner", () => {
    const html = renderPreview({ canManage: false, publishing: liveWithChanges });

    expect(html).toContain("This is the page a table card opens");
    expect(html).not.toContain("Table ordering");
    expect(html).not.toContain("lg:grid-cols-[minmax(0,420px)_320px]");
    expect(html).not.toContain("xl:grid-cols");
  });
});
