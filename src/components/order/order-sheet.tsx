"use client";

/**
 * The diner's cart as a bottom sheet — the phone's cart.
 *
 * "View order" raises it from the bottom edge of the screen. It is the phone
 * answer to a one-column menu: the cart cannot sit beside the dishes, so it
 * comes to the diner instead. Wide screens do not use it; there the order is
 * the sticky right-hand column (`OrderCartPanel`), and `useWideLayout` decides
 * which of the two is mounted.
 *
 * Inside a `PhoneFrame` the sheet pins to the frame's screen by being
 * portalled onto the frame's overlay layer; on a real diner page it pins to
 * the viewport, locks the page behind it, and closes on Escape, on its
 * backdrop, or with the × button.
 *
 * The sheet owns the overlay, the focus hand-off, and the line controls. The
 * footer is the caller's, because what belongs under the total differs: a real
 * "Send order" button, a preview notice that nothing was sent, or the
 * server's error.
 */

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { usePhoneScreenLayer } from "@/components/ui/phone-frame";
import type { OrderLine } from "@/features/orders/schema";

import { OrderCartLines } from "./order-cart";

export function OrderSheet({
  lines,
  currency,
  subtitle,
  showMenuBadges = false,
  onQuantityChange,
  note,
  onNoteChange,
  noteId,
  footer,
  onClose,
  returnFocusTo,
}: {
  lines: readonly OrderLine[];
  /** Currency for line prices; null renders bare numbers rather than guessing. */
  currency: string | null;
  /** "Café · Table 3" under the title, when the caller knows it. */
  subtitle?: ReactNode;
  /** Multi-menu orders label each line with the menu it came from. */
  showMenuBadges?: boolean;
  onQuantityChange: (index: number, quantity: number) => void;
  note: string;
  onNoteChange: (note: string) => void;
  noteId: string;
  /** Total, warnings, errors and the send button. */
  footer: ReactNode;
  onClose: () => void;
  /** Focus returns here on close, unless it has left the page (cart emptied). */
  returnFocusTo?: RefObject<HTMLButtonElement | null>;
}) {
  const layer = usePhoneScreenLayer();
  const panel = useRef<HTMLDivElement | null>(null);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  // Take focus when the sheet opens and hand it back to "View order" when it
  // goes away, so keyboard users are never dropped on the page body. The sheet
  // mounts per opening, so this runs once; `returnFocusTo` is a ref object and
  // therefore stable across renders.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    // Captured now, while the bar is on screen; checked on close in case the
    // cart emptied and the bar (and this button) went with it.
    const trigger = returnFocusTo?.current;
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, [returnFocusTo]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // On a real page the menu behind the sheet must not scroll with it. Inside a
  // frame there is nothing to lock: the sheet covers the frame's own screen.
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
        aria-label="Your order"
        tabIndex={-1}
        className={`sheet-up pointer-events-auto ${placed} inset-x-0 bottom-0 ${
          layer ? "z-10" : "z-50"
        } mx-auto flex max-h-[85%] w-full max-w-xl flex-col rounded-t-2xl border-t border-stone-200 bg-surface-base shadow-[0_-10px_30px_rgba(28,25,23,0.18)] outline-none`}
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink-900">Your order</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-ink-500">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-xs font-medium text-ink-500">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close your order"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-300 text-base font-semibold text-ink-600 transition-colors hover:border-amber-700 hover:text-amber-900"
            >
              ×
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <OrderCartLines
            lines={lines}
            currency={currency}
            showMenuBadges={showMenuBadges}
            onQuantityChange={onQuantityChange}
            note={note}
            onNoteChange={onNoteChange}
            noteId={noteId}
          />
        </div>

        <div className="mt-3 border-t border-stone-200 px-4 pt-3">{footer}</div>
      </div>
    </>,
    layer ?? document.body
  );
}
