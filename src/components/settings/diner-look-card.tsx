"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { DinerThemeProvider } from "@/components/order/diner-theme";
import { OrderPagePreview } from "@/components/order/order-page-preview";
import { PhoneFrame } from "@/components/ui/phone-frame";
import type { BrandAssetImage } from "@/features/brand-assets/schema";
import type { MenuDocument } from "@/features/menu/schema";
import { SCHEMA_VERSION } from "@/features/menu/schema";
import { fetchLiveMenuDoc } from "@/features/publishing/client";
import { fetchCafeMenus, fetchServerMenu } from "@/features/menus/sync";
import { DINER_THEME_PRESETS_UI } from "@/features/diner-theme/presets";
import { DINER_THEME_PRESETS } from "@/features/diner-theme/schema";
import {
  dinerThemePresetOf,
  type DinerTheme,
  type DinerThemePreset,
} from "@/features/diner-theme/schema";
import { updateDinerTheme, type RestaurantOption } from "@/features/tenancy/client";

const smallButton =
  "rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Sample menu for cafés with nothing published yet — clearly a stand-in,
 * never written anywhere. Labelled as a sample under the preview.
 */
const SAMPLE_MENU: MenuDocument = {
  schemaVersion: SCHEMA_VERSION,
  id: "sample-menu",
  title: "Sample menu",
  currency: "£",
  categories: [
    {
      id: "sample-mains",
      name: "Mains",
      sortOrder: 0,
      description: "Wood-fired mains, made to share.",
      cover: null,
      items: [
        {
          id: "sample-rigatoni",
          name: "Rigatoni alla vodka",
          description: "Creamy tomato, basil",
          price: 14.5,
          currency: null,
          sortOrder: 0,
          available: null,
          dietaryLabels: [],
          variants: [
            { name: "Regular", price: null },
            { name: "Large", price: 17.5 },
          ],
          options: [],
          reviewNotes: [],
          unpricedAccepted: false,
        },
        {
          id: "sample-crudo",
          name: "Tuna crudo",
          description: "Citrus, olive oil",
          price: 12.0,
          currency: null,
          sortOrder: 1,
          available: null,
          dietaryLabels: [],
          variants: [],
          options: [],
          reviewNotes: [],
          unpricedAccepted: false,
        },
      ],
    },
    {
      id: "sample-desserts",
      name: "Desserts",
      sortOrder: 1,
      description: "",
      cover: null,
      items: [
        {
          id: "sample-panna",
          name: "Panna cotta",
          description: "Vanilla, berries",
          price: 6.5,
          currency: null,
          sortOrder: 0,
          available: null,
          dietaryLabels: [],
          variants: [],
          options: [],
          reviewNotes: [],
          unpricedAccepted: false,
        },
      ],
    },
  ],
  modifierTemplates: [],
  labelMeanings: {},
  source: { provider: "demo" },
  updatedAt: "2026-11-25T00:00:00.000Z",
};

/**
 * Settings → Diner look (alternative A: single line + dialog).
 *
 * The closed card is one row — current dots + label + a Change button — so
 * Settings stays scannable. The preset grid and the side-by-side phone
 * preview live in the dialog. The preview is the shared `OrderPagePreview`
 * (same cover, rail, cards, sheets as the live landing) under
 * `DinerThemeProvider`, so there is one copy of diner markup — never a
 * dialog-only duplicate to drift.
 */
export function DinerLookCard({
  restaurant,
  canManage,
  onChanged,
}: {
  restaurant: RestaurantOption;
  canManage: boolean;
  onChanged: (updated: RestaurantOption) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<DinerThemePreset>(() =>
    dinerThemePresetOf(restaurant.dinerTheme ?? null)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeRef = useRef<HTMLButtonElement>(null);

  const current = dinerThemePresetOf(restaurant.dinerTheme ?? null);
  // The dialog edits a draft; opening re-seeds it from the saved theme here
  // (not in an effect) so a discarded pick never leaks into the next open.
  function handleOpen() {
    setDraft(current);
    setDialogOpen(true);
  }
  const currentDef = DINER_THEME_PRESETS_UI[current];

  async function handleSave() {
    if (!canManage || saving) return;
    setSaving(true);
    setError(null);
    try {
      const theme: DinerTheme = draft === "eucalyptus" ? null : { preset: draft };
      const updated = await updateDinerTheme(restaurant.id, theme);
      onChanged(updated);
      setDialogOpen(false);
      changeRef.current?.focus();
    } catch {
      setError("Could not save the diner look. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
      <h3 className="text-sm font-bold tracking-tight text-ink-900">Diner look</h3>
      <p className="mt-1 text-xs leading-5 text-ink-500">
        The theme for your diner ordering page. Saving applies it on the next diner visit — no
        republish.
      </p>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line-200 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <ThemeDots preset={current} />
          <span className="truncate text-sm font-medium text-ink-900">{currentDef.label}</span>
        </span>
        <button ref={changeRef} type="button" onClick={handleOpen} className={smallButton}>
          Change…
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger-700">
          {error}
        </p>
      )}
      {dialogOpen && (
        <DinerLookDialog
          draft={draft}
          onDraft={setDraft}
          saving={saving}
          canManage={canManage}
          restaurantId={restaurant.id}
          restaurantName={restaurant.name}
          restaurantLogo={restaurant.logo ?? null}
          restaurantCover={restaurant.cover ?? null}
          onSave={() => void handleSave()}
          onClose={() => {
            setDialogOpen(false);
            changeRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function ThemeDots({ preset }: { preset: DinerThemePreset }) {
  const def = DINER_THEME_PRESETS_UI[preset];
  const accent = def.overrides["--color-accent-700"] ?? "#4f7a6a";
  const page = def.overrides["--color-background"] ?? "#eef4f0";
  const card = def.overrides["--color-surface-base"] ?? "#ffffff";
  return (
    <span aria-hidden="true" className="flex -space-x-1">
      {[accent, page, card].map((color) => (
        <span
          key={color}
          style={{ backgroundColor: color }}
          className="h-4 w-4 rounded-full border border-line-300"
        />
      ))}
    </span>
  );
}

function DinerLookDialog({
  draft,
  onDraft,
  saving,
  canManage,
  restaurantId,
  restaurantName,
  restaurantLogo,
  restaurantCover,
  onSave,
  onClose,
}: {
  draft: DinerThemePreset;
  onDraft: (preset: DinerThemePreset) => void;
  saving: boolean;
  canManage: boolean;
  restaurantId: string;
  restaurantName: string;
  restaurantLogo: BrandAssetImage | null;
  restaurantCover: BrandAssetImage | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const doneRef = useRef<HTMLButtonElement>(null);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  useEffect(() => {
    doneRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const [preview, setPreview] = useState<
    | { kind: "loading" }
    | { kind: "live"; doc: MenuDocument; title: string }
    | { kind: "demo"; doc: MenuDocument }
  >({ kind: "loading" });

  // The preview shows the café's actual menu — the live snapshot diners
  // see when there is one, else the newest server draft. A café with no
  // menu yet gets a small clearly-labelled sample instead of an empty page.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { menus } = await fetchCafeMenus(restaurantId);
        const first = menus[0];
        if (!first) {
          if (!cancelled) setPreview({ kind: "demo", doc: SAMPLE_MENU });
          return;
        }
        const live = await fetchLiveMenuDoc(first.id).catch(() => null);
        if (cancelled) return;
        if (live) {
          setPreview({ kind: "live", doc: live, title: first.title });
          return;
        }
        const server = await fetchServerMenu(first.id).catch(() => null);
        if (cancelled) return;
        setPreview(
          server
            ? { kind: "live", doc: server.doc, title: first.title }
            : { kind: "demo", doc: SAMPLE_MENU }
        );
      } catch {
        if (!cancelled) setPreview({ kind: "demo", doc: SAMPLE_MENU });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  if (!mounted) return null;

  const def = DINER_THEME_PRESETS_UI[draft];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close diner look picker"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-surface-900/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface-base shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-0">
          <div>
            <h2 id={titleId} className="text-sm font-bold text-ink-900">
              Choose diner look
            </h2>
            <p className="mt-1 text-xs leading-5 text-ink-500">
              Pick a preset on the left, judge it on the phone, then save.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full border border-line-300 px-2 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            ✕
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-[300px_minmax(0,1fr)]">
          <div>
            <ul className="grid grid-cols-2 gap-2">
              {DINER_THEME_PRESETS.map((preset) => {
                const option = DINER_THEME_PRESETS_UI[preset];
                const selected = preset === draft;
                return (
                  <li key={preset}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onDraft(preset)}
                      className={`w-full rounded-xl border p-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 ${
                        selected
                          ? "border-accent-700 ring-2 ring-accent-700/20"
                          : "border-line-200 hover:border-line-300"
                      }`}
                    >
                      <ThemeDots preset={preset} />
                      <span className="mt-1 block text-xs font-semibold text-ink-900">
                        {option.label}
                      </span>
                      <span className="block text-[11px] leading-4 text-ink-500">
                        {option.blurb}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[11px] leading-4 text-ink-500">{def.blurb}</p>
          </div>
          <div className="min-w-0">
            <DinerThemeProvider theme={draft === "eucalyptus" ? null : { preset: draft }}>
              <PhoneFrame
                label={`Diner preview in ${def.label}`}
                widthClass="max-w-[420px]"
                heightClass="h-[min(72vh,780px)]"
              >
                {preview.kind === "loading" ? (
                  <p className="p-6 text-center text-xs text-ink-500">Finding your menu…</p>
                ) : (
                  <OrderPagePreview
                    doc={preview.doc}
                    restaurantName={restaurantName}
                    restaurantLogo={restaurantLogo}
                    restaurantCover={restaurantCover}
                  />
                )}
              </PhoneFrame>
            </DinerThemeProvider>
            <p className="mt-1 text-center text-[11px] text-ink-500">
              {preview.kind === "loading"
                ? "Loading the menu…"
                : preview.kind === "live"
                  ? `Showing “${preview.title}” — your actual menu.`
                  : "Sample menu — publish a menu and this preview shows it instead."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-100 p-4">
          <p className="text-xs text-ink-500">
            Current pick: <span className="font-semibold text-ink-900">{def.label}</span>
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={smallButton}>
              Cancel
            </button>
            {canManage && (
              <button
                ref={doneRef}
                type="button"
                onClick={onSave}
                disabled={saving}
                className="rounded-full bg-accent-700 px-4 py-1 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                {saving ? "Saving…" : "Save theme"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
