import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultWizardState,
  linkExpiryCopy,
  loadWizardLinkSent,
  loadWizardState,
  parseWizardState,
  publishWizardPath,
  resolveWizardRestaurant,
  saveWizardLinkSent,
  saveWizardState,
  wizardLinkStorageKey,
  wizardStorageKey,
  clearWizardLinkSent,
  clearWizardState,
  WIZARD_LINK_TTL_MS,
  type PublishWizardState,
} from "@/features/publishing/wizard-state";

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  } as Storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const FALLBACK: PublishWizardState = {
  restaurantName: "Fallback Café",
  restaurantId: "",
  slug: "fallback",
  theme: "classic",
  layout: "list",
};

describe("wizard prefill", () => {
  it("suggests a café name and derives a link slug from the title", () => {
    const state = defaultWizardState({ title: "Sunny Side Café — Lunch Menu" });
    expect(state.restaurantName).toBe("Sunny Side Café");
    expect(state.slug).toBe("sunny-side-cafe-lunch-menu");
    expect(state.theme).toBe("classic");
    expect(state.layout).toBe("list");
  });

  it("leaves the name empty rather than inventing one", () => {
    expect(defaultWizardState({ title: "Menu" }).restaurantName).toBe("");
    expect(defaultWizardState({ title: "Lunch Menu" }).slug).toBe("lunch-menu");
  });

  it("keeps the wizard path stable and encoded", () => {
    expect(publishWizardPath("menu id/1")).toBe("/menus/menu%20id%2F1/publish");
    expect(wizardStorageKey("menu-1")).toBe("eateryo:publish-wizard:menu-1");
  });
});

describe("restaurant choice", () => {
  const owners = [
    { id: "r-1", name: "One Café", role: "owner" as const },
    { id: "r-2", name: "Two Café", role: "owner" as const },
  ];

  it("asks for a name when the owner has no restaurant", () => {
    expect(resolveWizardRestaurant({ restaurantName: "  ", restaurantId: "" }, [])).toEqual({
      kind: "missing",
    });
    expect(resolveWizardRestaurant({ restaurantName: "New Café", restaurantId: "" }, [])).toEqual({
      kind: "create",
      name: "New Café",
    });
  });

  it("uses the only restaurant without asking", () => {
    expect(
      resolveWizardRestaurant({ restaurantName: "Ignored", restaurantId: "stale" }, [owners[0]!])
    ).toEqual({ kind: "existing", id: "r-1", name: "One Café" });
  });

  it("requires a choice when there are several and respects the selection", () => {
    expect(
      resolveWizardRestaurant({ restaurantName: "Ignored", restaurantId: "" }, owners)
    ).toEqual({
      kind: "choose",
    });
    expect(
      resolveWizardRestaurant({ restaurantName: "Ignored", restaurantId: "r-2" }, owners)
    ).toEqual({ kind: "existing", id: "r-2", name: "Two Café" });
  });
});

describe("form persistence", () => {
  it("saves, restores and clears the form", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const state: PublishWizardState = {
      restaurantName: "Retry Café",
      restaurantId: "r-1",
      slug: "lunch",
      theme: "bistro",
      layout: "columns",
    };

    saveWizardState("menu-1", state);
    expect(storage.getItem(wizardStorageKey("menu-1"))).toContain("Retry Café");
    expect(loadWizardState("menu-1", FALLBACK)).toEqual(state);

    clearWizardState("menu-1");
    expect(loadWizardState("menu-1", FALLBACK)).toEqual(FALLBACK);
  });

  it("falls back field by field instead of discarding a damaged form", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    storage.setItem(
      wizardStorageKey("menu-1"),
      JSON.stringify({
        restaurantName: "Saved Café",
        slug: "saved",
        theme: "neon",
        layout: "columns",
      })
    );

    expect(loadWizardState("menu-1", FALLBACK)).toEqual({
      ...FALLBACK,
      restaurantName: "Saved Café",
      slug: "saved",
      layout: "columns",
    });
  });

  it("ignores malformed JSON and non-object storage", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    storage.setItem(wizardStorageKey("menu-1"), "{not json");
    expect(loadWizardState("menu-1", FALLBACK)).toEqual(FALLBACK);
    expect(parseWizardState("nope", FALLBACK)).toEqual(FALLBACK);
  });
});

describe("pending link", () => {
  it("saves, restores and clears the sent link per menu", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const sent = { email: "owner@cafe.com", sentAt: Date.now() };

    saveWizardLinkSent("menu-1", sent);
    expect(storage.getItem(wizardLinkStorageKey("menu-1"))).toContain("owner@cafe.com");
    expect(loadWizardLinkSent("menu-1")).toEqual(sent);
    expect(loadWizardLinkSent("menu-2")).toBeNull();

    clearWizardLinkSent("menu-1");
    expect(loadWizardLinkSent("menu-1")).toBeNull();
  });

  it("rejects damaged or ancient link records", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    storage.setItem(wizardLinkStorageKey("menu-1"), "{not json");
    expect(loadWizardLinkSent("menu-1")).toBeNull();
    storage.setItem(
      wizardLinkStorageKey("menu-1"),
      JSON.stringify({ email: "", sentAt: Date.now() })
    );
    expect(loadWizardLinkSent("menu-1")).toBeNull();
    storage.setItem(
      wizardLinkStorageKey("menu-1"),
      JSON.stringify({ email: "owner@cafe.com", sentAt: Date.now() - 11 * 60 * 1000 })
    );
    expect(loadWizardLinkSent("menu-1")).toBeNull();
  });

  it("names the live countdown and the expiry", () => {
    const sentAt = 1_000_000;
    expect(linkExpiryCopy(sentAt, sentAt).expired).toBe(false);
    expect(linkExpiryCopy(sentAt, sentAt + 4 * 60 * 1000).text).toContain("min");
    expect(linkExpiryCopy(sentAt, sentAt + 4 * 60 * 1000 + 30 * 1000).expired).toBe(false);
    const expired = linkExpiryCopy(sentAt, sentAt + WIZARD_LINK_TTL_MS);
    expect(expired.expired).toBe(true);
    expect(linkExpiryCopy(sentAt, sentAt + 60 * 60 * 1000).expired).toBe(true);
  });
});
