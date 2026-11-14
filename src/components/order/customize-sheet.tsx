"use client";

/**
 * PROTOTYPE: the dish customizer as a bottom sheet.
 *
 * Tapping Add on a customizable dish raises this instead of adding
 * straight away: the menu list stays one line per dish, and the groups
 * (required open, optional collapsed — the same `OptionGroupFields`) live
 * here with a live-total Confirm bar. Plain dishes still add instantly
 * from the row; this sheet never mounts for them.
 *
 * Overlay, focus hand-off, scroll lock and the PhoneFrame layer follow
 * `OrderSheet` exactly, so it pins to the frame's screen in the owner
 * preview and to the viewport on a real diner page.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { usePhoneScreenLayer } from "@/components/ui/phone-frame";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { priceWithOptions, type OptionSelection } from "@/features/menu/option-groups";
import type { MenuItem } from "@/features/menu/schema";

import { OptionGroupFields } from "./option-groups";

export function CustomizeSheet({
  item,
  variantName,
  basePrice,
  currency,
  picks,
  error,
  onToggle,
  onConfirm,
  onClose,
}: {
  item: MenuItem;
  /** Human label for the size the row has selected, if the dish has sizes. */
  variantName: string | null;
  /** That size's price (null honestly stays null — never guessed). */
  basePrice: number | null;
  currency: string | null;
  picks: ReadonlyArray<OptionSelection>;
  /** The Add-gate message, when Confirm found a required group unanswered. */
  error: string | null;
  onToggle: (groupName: string, choiceName: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const layer = usePhoneScreenLayer();
  const panel = useRef<HTMLDivElement | null>(null);
  const livePrice = priceWithOptions(basePrice, item, picks);

  // Take focus when the sheet opens and hand it back to whatever opened it
  // (the row's Add button) when it goes away. Captured on mount because the
  // opener is focused at that exact moment.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const trigger = document.activeElement as HTMLElement | null;
    return () => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // On a real page the menu behind the sheet must not scroll with it. Inside
  // a frame there is nothing to lock: the sheet covers the frame's screen.
  useEffect(() => {
    if (layer) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [layer]);

  const placed = layer ? "absolute" : "fixed";

  return createPortal(
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className={`${placed} pointer-events-auto inset-0 cursor-default bg-surface-900/25`}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal={layer ? undefined : true}
        aria-label={`Customize ${item.name}`}
        tabIndex={-1}
        className={`sheet-up pointer-events-auto ${placed} inset-x-0 bottom-0 ${
          layer ? "z-10" : "z-50"
        } mx-auto flex max-h-[85%] w-full max-w-xl flex-col rounded-t-2xl border-t border-line-200 bg-surface-base shadow-[0_-10px_30px_rgba(28,25,23,0.18)] outline-none`}
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-ink-900">{item.name}</h2>
            <p className="mt-0.5 truncate text-xs text-ink-500">{variantName ?? "Standard"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${item.name} options`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-300 text-base font-semibold text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          <OptionGroupFields
            item={item}
            currency={currency}
            selections={picks}
            onToggle={onToggle}
          />
        </div>

        <div className="mt-1 border-t border-line-200 px-4 pt-3">
          {error && (
            <p role="alert" className="mb-2 text-xs text-danger-800">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className="w-full rounded-full bg-accent-700 px-5 py-2.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 active:scale-[0.99]"
          >
            {livePrice === null
              ? "Add to order"
              : `Add to order · ${formatPreviewPrice(livePrice, null, currency)}`}
          </button>
        </div>
      </div>
    </>,
    layer ?? document.body
  );
}
