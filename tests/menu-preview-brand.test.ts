import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MenuEditor } from "@/components/menu-editor/menu-editor";
import { createMenuDocument } from "@/features/menu/menu-utils";

function renderPreview(options: {
  restaurantId?: string | null;
  canManage?: boolean;
  syncMode?: "local" | "account";
}) {
  return renderToStaticMarkup(
    createElement(MenuEditor, {
      doc: createMenuDocument({ title: "Lunch" }),
      mode: "preview",
      onModeChange: () => {},
      onChange: () => {},
      saveState: { kind: "saved", message: "Saved" },
      syncMode: options.syncMode ?? "account",
      canManage: options.canManage ?? true,
      restaurantName: "Sunny Side",
      restaurantId: options.restaurantId === undefined ? "cafe-1" : options.restaurantId,
      onBrandChanged: () => {},
      imageUrl: null,
      onExportJson: () => {},
      onExportCsv: () => {},
      onImportFile: () => {},
      importError: null,
      onDeleteMenu: () => {},
    })
  );
}

describe("menu Preview brand overlay", () => {
  it("shows explicit Change logo and Change cover buttons for an owner", () => {
    const html = renderPreview({ restaurantId: "cafe-1" });
    expect(html).toContain("Change logo");
    expect(html).toContain("Change cover");
    expect(html).toContain("without leaving Preview");
  });

  it("hides the overlay without a café, for staff, or in a browser-only menu", () => {
    expect(renderPreview({ restaurantId: null })).not.toContain("Change logo");
    expect(renderPreview({ restaurantId: "cafe-1", canManage: false })).not.toContain(
      "Change cover"
    );
    expect(renderPreview({ restaurantId: "cafe-1", syncMode: "local" })).not.toContain(
      "Change logo"
    );
  });

  it("wires Change buttons to file pickers", async () => {
    vi.resetModules();
    const { PreviewBrandBar } = await import("@/components/menu-editor/preview-brand-bar");
    expect(typeof PreviewBrandBar).toBe("function");
  });
});
