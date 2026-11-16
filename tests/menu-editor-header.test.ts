import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MenuEditor } from "@/components/menu-editor/menu-editor";
import { createMenuDocument } from "@/features/menu/menu-utils";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import type { EditorMode } from "@/features/navigation/routes";

/**
 * Leaving preview or reorder for the library skips the workspace the user
 * was just in, so the leading button there is "Back to edit" in the same
 * spot — never a second "All menus" beside it. Edit mode keeps "All menus"
 * as the way out.
 */
function render(mode: EditorMode): string {
  return renderToStaticMarkup(
    createElement(MenuEditor, {
      doc: createSampleMenuDocument(),
      mode,
      onModeChange: () => {},
      onChange: () => {},
      saveState: { kind: "saved", message: "Saved" },
      syncMode: "local",
      imageUrl: null,
      onExportJson: () => {},
      onExportCsv: () => {},
      onImportFile: () => {},
      importError: null,
      onDeleteMenu: () => {},
      onBack: () => {},
    })
  );
}

function renderEmpty(): string {
  return renderToStaticMarkup(
    createElement(MenuEditor, {
      doc: createMenuDocument({ title: "Untitled menu" }),
      mode: "edit",
      onModeChange: () => {},
      onChange: () => {},
      saveState: { kind: "saved", message: "Saved" },
      syncMode: "local",
      imageUrl: null,
      onExportJson: () => {},
      onExportCsv: () => {},
      onImportFile: () => {},
      importError: null,
      onDeleteMenu: () => {},
      onBack: () => {},
    })
  );
}

describe("MenuEditor header navigation", () => {
  it("leads with All menus in edit mode", () => {
    const html = render("edit");
    expect(html).toContain("← All menus");
    expect(html).not.toContain("Back to edit");
  });

  it.each(["preview", "reorder"] as const)("leads with Back to edit in %s mode", (mode) => {
    const html = render(mode);
    expect(html).toContain("← Back to edit");
    expect(html).not.toContain("← All menus");
    expect(html.match(/← Back to edit/g)).toHaveLength(1);
  });
});

describe("MenuEditor tab strip", () => {
  it("shows all five tabs with the entry-rule tab selected", () => {
    const html = render("edit");
    expect(html).toContain('role="tablist"');
    for (const label of [
      "Settings &amp; hours",
      "Categories",
      "↕ Reorder",
      "Preview order page",
      "Add-on sets",
    ]) {
      expect(html).toContain(label);
    }
    // The sample menu has dishes, so Categories is the entry tab — and the
    // only selected one. The dish count and to-check badges ride with it.
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    const afterSelected = html.split('aria-selected="true"')[1] ?? "";
    expect(afterSelected.slice(0, 400)).toContain("Categories");
    expect(html).toContain("to check");
  });

  it("lands an empty menu on Settings & hours", () => {
    const html = renderEmpty();
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    const afterSelected = html.split('aria-selected="true"')[1] ?? "";
    expect(afterSelected.slice(0, 400)).toContain("Settings");
    expect(html).toContain("Settings &amp; hours moves here");
  });

  it("marks the mode tab selected outside edit mode", () => {
    for (const [mode, label] of [
      ["reorder", "↕ Reorder"],
      ["preview", "Preview order page"],
    ] as const) {
      const html = render(mode);
      expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
      expect(html).toContain(label);
    }
  });
});
