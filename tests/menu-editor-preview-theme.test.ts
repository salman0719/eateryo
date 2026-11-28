import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MenuEditor } from "@/components/menu-editor/menu-editor";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import type { DinerTheme } from "@/features/diner-theme/schema";

/**
 * The Preview tab wears the café's diner look — the same theme a table
 * card shows — instead of always rendering the shipped default.
 */
function render(theme?: DinerTheme | null): string {
  return renderToStaticMarkup(
    createElement(MenuEditor, {
      doc: createSampleMenuDocument(),
      mode: "preview",
      onModeChange: () => {},
      onChange: () => {},
      saveState: { kind: "saved", message: "Saved" },
      syncMode: "account",
      imageUrl: null,
      onExportJson: () => {},
      onExportCsv: () => {},
      onImportFile: () => {},
      importError: null,
      onDeleteMenu: () => {},
      restaurantName: "Sunny Side Café",
      restaurantTheme: theme ?? null,
    })
  );
}

describe("MenuEditor preview theme", () => {
  it("renders the café's diner preset around the order page", () => {
    const html = render({ preset: "notturno" });
    expect(html).toContain('data-diner-theme="notturno"');
  });

  it("falls back to the shipped look without a theme", () => {
    const html = render(null);
    expect(html).toContain('data-diner-theme="eucalyptus"');
  });
});
