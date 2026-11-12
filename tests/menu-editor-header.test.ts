import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MenuEditor } from "@/components/menu-editor/menu-editor";
import { createMenuDocument } from "@/features/menu/menu-utils";
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
      doc: createMenuDocument({ title: "Lunch" }),
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
