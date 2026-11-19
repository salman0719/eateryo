import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MenuEditor } from "@/components/menu-editor/menu-editor";
import { createMenuDocument } from "@/features/menu/menu-utils";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import type { EditorMode } from "@/features/navigation/routes";

/**
 * The tab strip is the editor's first row. The tabs themselves move between
 * the workspace, reorder and preview, so no "Back to edit" sits above them,
 * and leaving for the library is the shell's own (sidebar, phone tab bar) —
 * not a line of chrome in the editor. The save status rides on the strip.
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
    })
  );
}

describe("MenuEditor header", () => {
  it.each([
    ["edit", "Search items, descriptions, or categories…"],
    ["preview", "What a table card opens"],
    ["reorder", "Drag rows by the grip"],
  ] as const)("leads with the tabs in %s mode", (mode, firstSurface) => {
    const html = render(mode);
    expect(html).not.toContain("← All menus");
    expect(html).not.toContain("Back to edit");
    // The strip comes before the mode's own surface, not under a header row.
    const strip = html.indexOf('role="tablist"');
    expect(strip).toBeGreaterThan(-1);
    expect(strip).toBeLessThan(html.indexOf(firstSurface));
  });

  it("carries the save status on the tab row, after the tabs", () => {
    const html = render("edit");
    expect(html).toContain("Saved");
    expect(html.indexOf("Saved")).toBeGreaterThan(html.indexOf("Add-on sets"));
  });

  it("never claims a save it cannot see: the checking state keeps a skeleton", () => {
    const html = renderToStaticMarkup(
      createElement(MenuEditor, {
        doc: createSampleMenuDocument(),
        mode: "edit",
        onModeChange: () => {},
        onChange: () => {},
        saveState: { kind: "checking", message: "Checking where this menu is saved…" },
        syncMode: "local",
        imageUrl: null,
        onExportJson: () => {},
        onExportCsv: () => {},
        onImportFile: () => {},
        importError: null,
        onDeleteMenu: () => {},
      })
    );
    expect(html).toContain("Checking where this menu is saved…");
    expect(html).not.toMatch(/>\s*Saved\s*</);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A menu started from scratch has nothing in it, so the category strip — the
 * only "+ Category" control — is not rendered. The Categories tab still has to
 * offer a way to add the first category itself instead of telling the owner to
 * use a control that is not on the screen.
 */
describe("MenuEditor on an empty menu", () => {
  it("offers the first category on the Categories tab", () => {
    const doc = createMenuDocument({ title: "Untitled menu" });
    const store = new Map<string, string>([[`menu-editor-subtab:${doc.id}`, "categories"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    const html = renderToStaticMarkup(
      createElement(MenuEditor, {
        doc,
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
      })
    );
    expect(html).toContain("No categories yet");
    // One control, and it is the button — not a sentence about the strip.
    expect(html.match(/\+ Add category/g)).toHaveLength(1);
    expect(html).not.toContain("Add a category above");
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
    const html = renderToStaticMarkup(
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
      })
    );
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    const afterSelected = html.split('aria-selected="true"')[1] ?? "";
    expect(afterSelected.slice(0, 400)).toContain("Settings");
    // Step 10: the tab renders the real management surface, not a
    // placeholder — identity first, then data and danger controls.
    expect(html).toContain("Menu title");
    expect(html).toContain("Export JSON");
    expect(html).toContain("Delete menu");
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
