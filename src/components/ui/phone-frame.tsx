"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * The layer above a phone screen's scroller. Content portalled here stays put
 * while the page behind it scrolls, which is what a bottom sheet needs: inside
 * the scroller it would ride along with the menu. Null when the preview is not
 * framed, so callers can fall back to a viewport sheet.
 */
const PhoneScreenLayerContext = createContext<HTMLDivElement | null>(null);

/** The frame's overlay layer, or null when not rendered inside a PhoneFrame. */
export function usePhoneScreenLayer() {
  return useContext(PhoneScreenLayerContext);
}

/**
 * A phone bezel around a live component (the menu preview, not a screenshot).
 * Used by the publish success screen so the owner sees the page the way a
 * guest will, without leaving the app.
 */
export function PhoneFrame({
  children,
  label,
  heightClass = "max-h-[580px]",
  widthClass = "max-w-[340px]",
}: {
  children: ReactNode;
  /** Accessible description of what the framed view shows. */
  label: string;
  /** How wide the device is; the editor has room for a larger screen. */
  widthClass?: string;
  /**
   * Viewport class for the scrollable screen. The default fits beside a form;
   * a fixed height (`h-[...]`) makes the frame fill the space when the preview
   * is the main thing on screen.
   */
  heightClass?: string;
}) {
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);

  return (
    <figure aria-label={label} className={`mx-auto w-full ${widthClass}`}>
      <div className="rounded-[2.4rem] border-[10px] border-line-900 bg-surface-900 shadow-xl">
        <div className="relative overflow-hidden rounded-[1.7rem] bg-surface-base">
          <div className={`phone-scroll relative overflow-y-auto ${heightClass}`}>
            <div
              aria-hidden="true"
              className="sticky top-0 z-10 mx-auto h-5 w-24 rounded-b-2xl bg-surface-900"
            />
            {/* Edge to edge: the framed content is the diner's page, and its
                sticky bar should reach the screen edges, not float inside a pad. */}
            <div className="min-h-full">
              <PhoneScreenLayerContext.Provider value={layer}>
                {children}
              </PhoneScreenLayerContext.Provider>
            </div>
          </div>
          {/* Overlay layer: sheets live here so they do not scroll away. */}
          <div ref={setLayer} className="pointer-events-none absolute inset-0 z-30" />
        </div>
      </div>
      <figcaption className="mt-2 text-center text-[11px] text-ink-500">{label}</figcaption>
    </figure>
  );
}
