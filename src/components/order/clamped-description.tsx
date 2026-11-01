"use client";

import { useEffect, useId, useRef, useState } from "react";

import { DESCRIPTION_CLAMP_CLASS, descriptionToggle, hidesClampedText } from "./description-clamp";

/**
 * A dish description on the diner page (009).
 *
 * Two lines by default, so a paragraph cannot push the size picker and Add
 * button away from the dish they belong to, and so rows next to each other
 * stay comparable heights. The rest is one tap away — never truncated,
 * because allergen and ingredient notes live in this text.
 *
 * The row measures itself once per mount (and again after a collapse) rather
 * than on every render, and only then decides whether the control is worth
 * showing: a short description must not get a dead "More".
 */
export function ClampedDescription({ text, name }: { text: string; name: string }) {
  const descriptionId = useId();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    // Open text fits its box by definition; measuring it would just clear the
    // overflow flag and take away the control that closes it again.
    if (expanded) return;
    setOverflowing(hidesClampedText(paragraph.current));
  }, [expanded, text]);

  const toggle = descriptionToggle(expanded, overflowing);

  return (
    <>
      <p
        ref={paragraph}
        id={descriptionId}
        className={`mt-0.5 text-sm break-words text-stone-600 ${
          toggle.expanded ? "" : DESCRIPTION_CLAMP_CLASS
        }`}
      >
        {text}
      </p>
      {toggle.show && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={toggle.expanded}
          aria-controls={descriptionId}
          aria-label={`${toggle.label} description for ${name}`}
          className="mt-0.5 rounded text-xs font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          {toggle.label}
        </button>
      )}
    </>
  );
}
