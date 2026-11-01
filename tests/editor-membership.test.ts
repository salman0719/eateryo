import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MenuEditor } from "@/components/menu-editor/menu-editor";
import { PublishPanel } from "@/components/menu-editor/publish-panel";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";

/**
 * 003 — the editor opened saying "Saved in this browser" for a menu the
 * account already held, and the publish panel offered to create a café the
 * owner already had. Both now take three answers: on the account, proved
 * browser-only, and not read yet (`null`), which claims neither.
 */

function renderEditor(onServer: boolean | null): string {
  const doc = createSampleMenuDocument();
  return renderToStaticMarkup(
    createElement(MenuEditor, {
      doc,
      mode: "edit",
      onModeChange: () => {},
      onChange: () => {},
      saveState: { kind: "saved", message: "Saved", detail: "Saved to your account." },
      syncMode: "account",
      imageUrl: null,
      onExportJson: () => {},
      onExportCsv: () => {},
      onImportFile: () => {},
      importError: null,
      onDeleteMenu: () => {},
      onBack: () => {},
      onServer,
      onStartPublish: () => {},
      publishing: {
        status: null,
        loaded: true,
        busy: false,
        error: null,
        inAccount: onServer,
        liveDoc: null,
        liveDocState: "idle",
        onPublish: () => {},
        onUnpublish: () => {},
      },
    })
  );
}

function renderPublishPanel(inAccount: boolean | null): string {
  return renderToStaticMarkup(
    createElement(PublishPanel, {
      signedIn: true,
      draftDoc: createSampleMenuDocument(),
      controls: {
        status: null,
        loaded: true,
        busy: false,
        error: null,
        inAccount,
        liveDoc: null,
        liveDocState: "idle",
        onPublish: () => {},
        onUnpublish: () => {},
      },
    })
  );
}

describe("editor storage copy", () => {
  it("claims neither home while the account's list has not answered", () => {
    const html = renderEditor(null);
    expect(html).toContain("Checking where this menu is saved");
    expect(html).not.toContain("Add it to your account");
    expect(html).not.toContain("saved to your account");
    // The café-creating CTA is only for a menu proven to be browser-only.
    expect(html).not.toContain("we create your café");
  });

  it("offers the move once a read proved the menu is browser-only", () => {
    const html = renderEditor(false);
    expect(html).toContain("Add it to your account");
    expect(html).not.toContain("Checking where this menu is saved");
  });

  it("says the account owns it when it does", () => {
    const html = renderEditor(true);
    expect(html).toContain("saved to your account");
    expect(html).not.toContain("Add it to your account");
  });
});

describe("publish panel membership", () => {
  it("checks instead of offering to create a café while unknown", () => {
    const html = renderPublishPanel(null);
    expect(html).toContain("Checking whether this menu is on your account");
    expect(html).not.toContain("we create your café");
    expect(html).not.toContain("Set up table ordering");
  });

  it("offers the setup flow for a menu proved to be browser-only", () => {
    const html = renderPublishPanel(false);
    expect(html).toContain("still only in this browser");
    expect(html).not.toContain("Checking whether this menu is on your account");
  });
});
