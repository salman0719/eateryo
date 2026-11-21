"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { DinerCoverHeader } from "@/components/order/order-menu";
import { PhoneFrame } from "@/components/ui/phone-frame";

import {
  brandAssetAspectWarning,
  type BrandAssetAspectWarning,
} from "@/features/brand-assets/aspect";
import { readBrandAssetSize } from "@/features/brand-assets/prepare";
import type { BrandAssetKind } from "@/features/brand-assets/schema";
import { brandAssetCopy } from "@/features/brand-assets/ref";
import { uploadBrandAsset } from "@/features/brand-assets/upload";
import { ItemImageError } from "@/features/item-images/errors";
import { ItemImagePrepareError } from "@/features/item-images/prepare";
import { validateImageFile } from "@/lib/image-constraints";
import { updateBrandAssets, type RestaurantOption } from "@/features/tenancy/client";

/**
 * Settings → Brand: the restaurant logo and cover photo, uploads only.
 *
 * Each slot picks a file, validates it, uploads the pre-sized copies, and
 * stores the reference on the restaurant — the same pipeline as dish photos,
 * so the menu-config and live-preview entry points reuse it unchanged.
 * There is deliberately no crop in this step: the stored pixels stay whole
 * and the render crops (`object-cover`). The Preview button opens the diner
 * header in a phone frame, so the settings page itself stays compact.
 *
 * Images render as a plain CDN `<img>`, the same rule as dish photos: the
 * optimizer must never touch owner images.
 */

const smallButton =
  "rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

type SlotState =
  | { status: "idle" }
  /** Measuring the picked file before deciding whether to warn. */
  | { status: "checking" }
  /** Wrong shape: the owner can continue anyway or pick another file. */
  | { status: "aspect"; file: File; warning: BrandAssetAspectWarning }
  | { status: "working"; percent: number }
  | { status: "error"; message: string };

const SLOT_COPY: Record<BrandAssetKind, { title: string; hint: string; inputLabel: string }> = {
  logo: {
    title: "Logo",
    hint: "Square-ish works best — it sits in a round tile on your pages.",
    inputLabel: "Choose a logo file",
  },
  cover: {
    title: "Cover photo",
    hint: "Wide works best — the page crops it into a slim band.",
    inputLabel: "Choose a cover photo file",
  },
};

export function BrandCard({
  restaurant,
  canManage,
  onChanged,
}: {
  restaurant: RestaurantOption;
  /** Owner-only writes; anyone who can see the café sees the tiles. */
  canManage: boolean;
  /** Called with the server's answer after a change lands, so the workspace files it. */
  onChanged: (updated: RestaurantOption) => void;
}) {
  const [logoState, setLogoState] = useState<SlotState>({ status: "idle" });
  const [coverState, setCoverState] = useState<SlotState>({ status: "idle" });
  const [previewOpen, setPreviewOpen] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);

  const setState = (kind: BrandAssetKind, state: SlotState) =>
    (kind === "logo" ? setLogoState : setCoverState)(state);

  /** Upload the file the owner has already agreed to, warning and all. */
  async function upload(kind: BrandAssetKind, file: File) {
    setState(kind, { status: "working", percent: 0 });
    try {
      const image = await uploadBrandAsset(file, kind, {
        onProgress: (percent) => setState(kind, { status: "working", percent }),
      });
      const updated = await updateBrandAssets(restaurant.id, { [kind]: image });
      onChanged(updated);
      setState(kind, { status: "idle" });
    } catch (error) {
      setState(kind, {
        status: "error",
        message:
          error instanceof ItemImageError
            ? error.message
            : "The photo could not be uploaded. Try again.",
      });
    }
  }

  /**
   * Measure the picked file first. A shape that does not suit the slot is a
   * prompt, not a refusal: the owner may still continue, and only then does
   * the upload start.
   */
  async function handleFile(kind: BrandAssetKind, file: File) {
    setState(kind, { status: "checking" });
    const early = validateImageFile(file);
    if (!early.valid) {
      setState(kind, { status: "error", message: early.message });
      return;
    }

    let warning: BrandAssetAspectWarning | null;
    try {
      warning = brandAssetAspectWarning(kind, await readBrandAssetSize(file));
    } catch (error) {
      setState(kind, {
        status: "error",
        message:
          error instanceof ItemImagePrepareError || error instanceof ItemImageError
            ? error.message
            : "This photo could not be read in your browser. Try a JPEG, PNG, or WebP.",
      });
      return;
    }

    if (warning) {
      setState(kind, { status: "aspect", file, warning });
      return;
    }
    await upload(kind, file);
  }

  async function handleRemove(kind: BrandAssetKind) {
    setState(kind, { status: "working", percent: 0 });
    try {
      const updated = await updateBrandAssets(restaurant.id, { [kind]: null });
      onChanged(updated);
      setState(kind, { status: "idle" });
    } catch {
      setState(kind, {
        status: "error",
        message: "Could not remove the photo. Check your connection and try again.",
      });
    }
  }

  return (
    <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
      <h3 className="text-sm font-bold tracking-tight text-ink-900">Brand</h3>
      <p className="mt-1 text-xs leading-5 text-ink-500">
        Your logo and cover photo, shown on your published pages.
      </p>

      {(["logo", "cover"] as const).map((kind) => {
        const asset = restaurant[kind];
        const copy = brandAssetCopy(asset);
        const state = kind === "logo" ? logoState : coverState;
        const inputRef = kind === "logo" ? logoInput : coverInput;
        const working = state.status === "working";
        // Measuring counts as busy: the owner cannot pick a second file in the
        // middle of the first one's decode.
        const busy = working || state.status === "checking";
        const slot = SLOT_COPY[kind];
        return (
          <div key={kind} className="mt-4 flex gap-3">
            {copy ? (
              // eslint-disable-next-line @next/next/no-img-element -- brand asset served straight from the CDN at its stored size
              <img
                src={copy.url}
                alt=""
                width={copy.width}
                height={copy.height}
                loading="lazy"
                decoding="async"
                className={
                  kind === "logo"
                    ? "h-20 w-20 shrink-0 rounded-2xl border border-line-200 object-cover"
                    : "h-24 w-full max-w-xs shrink-0 rounded-xl border border-line-200 object-cover"
                }
              />
            ) : (
              <span
                aria-hidden="true"
                className={
                  kind === "logo"
                    ? "flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-dashed border-line-300 bg-surface-base text-sm font-bold text-ink-400"
                    : "flex h-24 w-full max-w-xs shrink-0 items-center justify-center rounded-xl border border-dashed border-line-300 bg-surface-base px-3 text-center text-xs text-ink-400"
                }
              >
                {kind === "logo"
                  ? restaurant.name.trim().charAt(0).toUpperCase() || "?"
                  : "No cover yet"}
              </span>
            )}
            <div className="grid min-w-0 flex-1 content-start gap-1">
              <p className="text-sm font-semibold text-ink-900">{slot.title}</p>
              <p className="text-xs leading-5 text-ink-500">{slot.hint}</p>
              {state.status === "error" && (
                <p role="alert" className="text-xs text-danger-700">
                  {state.message}
                </p>
              )}
              {working && state.status === "working" && (
                <p className="text-xs text-ink-500">Uploading… {state.percent}%</p>
              )}
              {state.status === "checking" && (
                <p className="text-xs text-ink-500">Checking the photo…</p>
              )}
              {state.status === "aspect" && (
                <div className="rounded-lg border border-warning-300 bg-warning-50 px-2 py-1.5">
                  <p role="alert" className="text-xs leading-5 text-warning-800">
                    {state.warning.message}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void upload(kind, state.file)}
                      className={smallButton}
                    >
                      Upload anyway
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // Back to a clean slot and straight into the picker, so
                        // answering the warning costs one click.
                        setState(kind, { status: "idle" });
                        inputRef.current?.click();
                      }}
                      className={smallButton}
                    >
                      Choose another
                    </button>
                  </div>
                </div>
              )}
              {canManage && state.status !== "aspect" && (
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={busy}
                    className={smallButton}
                  >
                    {copy
                      ? `Replace ${kind === "logo" ? "logo" : "cover"}`
                      : `Add ${kind === "logo" ? "logo" : "cover"}`}
                  </button>
                  {copy && (
                    <button
                      type="button"
                      onClick={() => void handleRemove(kind)}
                      disabled={busy}
                      className={smallButton}
                    >
                      Remove
                    </button>
                  )}
                  <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    aria-label={slot.inputLabel}
                    className="hidden"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      // Reset so the same file can be picked again after an error.
                      event.target.value = "";
                      if (file) void handleFile(kind, file);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line-100 pt-3">
        <p className="text-xs leading-5 text-ink-500">
          See the header the way a table card opens it, with your logo and cover.
        </p>
        <button
          ref={previewButtonRef}
          type="button"
          onClick={() => setPreviewOpen(true)}
          className={smallButton}
        >
          Preview
        </button>
      </div>

      {previewOpen && (
        <BrandPreviewDialog
          restaurant={restaurant}
          canManage={canManage}
          onPick={(kind) => {
            // Back to the slot's picker in one tap: shut the preview first,
            // then open the file dialog the Change button names.
            setPreviewOpen(false);
            (kind === "logo" ? logoInput : coverInput).current?.click();
            previewButtonRef.current?.focus();
          }}
          onClose={() => {
            setPreviewOpen(false);
            previewButtonRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/**
 * The deferred Settings preview: the diner header in a phone frame, not a
 * second upload flow. The header is the real `DinerCoverHeader` (table 1 as
 * the example), so the owner judges the same band and tile a diner sees;
 * the full menu with dishes stays in the editor's Preview tab, which has a
 * document to render.
 */
function BrandPreviewDialog({
  restaurant,
  canManage,
  onPick,
  onClose,
}: {
  restaurant: RestaurantOption;
  canManage: boolean;
  /** Close the preview, then open the named slot's file picker. */
  onPick: (kind: BrandAssetKind) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const doneRef = useRef<HTMLButtonElement>(null);
  // False on the server and during hydration, true once mounted on the client.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Focus the way out on open; Escape and the scrim close it.
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

  // Lock the page scroll while the preview is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close preview"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-surface-900/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-surface-base shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-0">
          <div>
            <h2 id={titleId} className="text-sm font-bold text-ink-900">
              Diner header preview
            </h2>
            <p className="mt-1 text-xs leading-5 text-ink-500">
              The band and tile from a table card, with your brand on it. Table 1 is the example.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="shrink-0 rounded-full border border-line-300 px-2 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5">
          <PhoneFrame label="Diner header with your logo and cover">
            <DinerCoverHeader
              restaurantName={restaurant.name}
              tableLabel="1"
              logo={restaurant.logo ?? null}
              cover={restaurant.cover ?? null}
              bleed
            />
          </PhoneFrame>
          <p className="mt-2 text-center text-xs text-ink-500">
            The full menu with your dishes is in the editor&apos;s Preview tab.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line-100 p-4">
          {canManage && (
            <>
              <button type="button" onClick={() => onPick("logo")} className={smallButton}>
                Change logo
              </button>
              <button type="button" onClick={() => onPick("cover")} className={smallButton}>
                Change cover
              </button>
            </>
          )}
          <button
            ref={doneRef}
            type="button"
            onClick={onClose}
            className="rounded-full bg-accent-700 px-4 py-1 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
