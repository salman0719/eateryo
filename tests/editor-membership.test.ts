import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MenuEditor } from "@/components/menu-editor/menu-editor";
import { PublishPanel } from "@/components/menu-editor/publish-panel";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";

/**
 * 003 — the editor opened saying "Saved in this browser" for a menu the
 * account already held, and the publish panel offered to create a café the
 * owner already had. Both now take three answers: on the account, proved
 * browser-only, and not read yet (`null`), which claims neither.
 *
 * 016 — a read that failed is a fourth answer: the same three surfaces say the
 * account couldn't be checked and offer a retry, never the browser-only claim
 * and never the café-creating flow.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Which tab the editor shows. The sample menu has dishes, so the entry rule
 * lands on Categories; pass "settings" to read the management surface the
 * Settings tab owns since step 10 (identity, hours, footnote).
 */
function renderEditor(
  onServer: boolean | null,
  accountCheckFailed = false,
  tab: "settings" | null = null
): string {
  const doc = createSampleMenuDocument();
  if (tab) {
    const store = new Map<string, string>([[`menu-editor-subtab:${doc.id}`, tab]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  }
  return renderToStaticMarkup(
    createElement(MenuEditor, {
      doc,
      mode: "edit",
      onModeChange: () => {},
      onChange: () => {},
      saveState: {
        kind: "saved",
        message: "Saved",
        detail: accountCheckFailed
          ? "Saved here — your account couldn't be checked."
          : "Saved to your account.",
      },
      syncMode: "account",
      imageUrl: null,
      onExportJson: () => {},
      onExportCsv: () => {},
      onImportFile: () => {},
      importError: null,
      onDeleteMenu: () => {},
      onBack: () => {},
      onServer,
      accountCheckFailed,
      onRetryAccountCheck: () => {},
      onStartPublish: () => {},
      publishing: {
        status: null,
        loaded: true,
        busy: false,
        error: null,
        inAccount: onServer,
        accountCheckFailed,
        onRetryAccountCheck: () => {},
        liveDoc: null,
        liveDocState: "idle",
        onPublish: () => {},
        onUnpublish: () => {},
      },
    })
  );
}

function renderPublishPanel(inAccount: boolean | null, accountCheckFailed = false): string {
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
        accountCheckFailed,
        onRetryAccountCheck: () => {},
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
    // The wait is a placeholder, not a sentence the page then retracts.
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("Checking where this menu is saved");
    expect(html).not.toContain("Add it to your account");
    expect(html).not.toContain("saved to your account");
    // The café-creating CTA is only for a menu proven to be browser-only.
    expect(html).not.toContain("we create your café");
    // Same for the helper paragraph above the fields: an unread list is not
    // "your café already exists", not "one click publishes it", and not the
    // account's "go to Preview" wording either.
    expect(html).not.toContain("to publish it for your tables");
    expect(html).not.toContain("to see it as diners will");
  });

  it("offers the move once a read proved the menu is browser-only", () => {
    // The footnote lives on Settings since step 10; the publish hint stays
    // on Categories. Same state, one tab each — switching tabs is the only
    // difference.
    const settings = renderEditor(false, false, "settings");
    expect(settings).toContain("Add it to your account");
    const categories = renderEditor(false);
    expect(categories).toContain("we create your café");
    expect(categories).not.toContain("Checking where this menu is saved");
    // And neither surface leaks onto the other's tab.
    expect(categories).not.toContain("Add it to your account");
    expect(settings).not.toContain("we create your café");
  });

  it("says the account owns it when it does", () => {
    const settings = renderEditor(true, false, "settings");
    expect(settings).toContain("saved to your account");
    expect(settings).not.toContain("Add it to your account");
    const categories = renderEditor(true);
    expect(categories).toContain("to publish it for your tables");
  });
});

describe("editor copy after a failed account read", () => {
  it("says the account couldn't be checked instead of claiming the browser", () => {
    const settings = renderEditor(null, true, "settings");
    expect(settings).toContain("Saved here");
    expect(settings).toContain("We couldn");
    expect(settings).toContain("may also be there");
    // An answer is not a wait, so the placeholders are gone.
    expect(settings).not.toContain("Checking where this menu is saved");
    expect(settings).not.toContain("animate-pulse");
    // Neither false claim: no browser-only sentence, no move offer, and no
    // café-creating publish flow offered on a guess (007).
    expect(settings).not.toContain("browser only");
    expect(settings).not.toContain("Add it to your account");
    expect(settings).not.toContain("we create your café");
    // The retry is the only way forward, and it is offered on both tabs.
    expect(settings.match(/Try again/g)).toHaveLength(1);
    const categories = renderEditor(null, true);
    expect(categories).not.toContain("Checking where this menu is saved");
    expect(categories).not.toContain("we create your café");
    expect(categories.match(/Try again/g)).toHaveLength(1);
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

  it("stops the café-creating setup while the account is unreadable", () => {
    const html = renderPublishPanel(null, true);
    expect(html).toContain("Not checked");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Set up table ordering");
    expect(html).not.toContain("Checking whether this menu is on your account");
    expect(html).not.toContain("animate-pulse");
  });
});
