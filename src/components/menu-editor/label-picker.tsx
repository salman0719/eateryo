"use client";

import { useEffect, useRef, useState } from "react";

import {
  cleanDietaryLabel,
  dietaryLabelMeaning,
  dietaryLabelUsage,
  isStarterDietaryLabel,
} from "@/features/menu/dietary-labels";
import type { MenuDocument } from "@/features/menu/schema";

/**
 * Step 6 of the redesign: the dietary label picker modal.
 *
 * Every label in the menu's vocabulary with its meaning and usage count —
 * tick to apply, untick to remove. Add-new takes a code plus a meaning;
 * the meaning is stored on the menu for custom codes (starter codes keep
 * their dictionary explanations). Meanings are never invented: a custom
 * code without one simply shows no tooltip until the owner writes it.
 */

const smallButton =
  "rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

export function LabelPicker({
  doc,
  applied,
  onToggle,
  onAddNew,
  onClose,
}: {
  doc: MenuDocument;
  /** Labels already on this dish. */
  applied: readonly string[];
  /** Tick or untick a vocabulary label. */
  onToggle: (code: string, on: boolean) => void;
  /** Add a new code (and store its meaning when custom). Applies it too. */
  onAddNew: (code: string, meaning: string) => void;
  onClose: () => void;
}) {
  const usage = dietaryLabelUsage([doc]);
  const appliedKeys = new Set(applied.map((label) => cleanDietaryLabel(label).toLowerCase()));
  const [code, setCode] = useState("");
  const [meaning, setMeaning] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cleanedCode = cleanDietaryLabel(code);
  const codeKey = cleanedCode.toLowerCase();
  const inVocabulary =
    codeKey !== "" && usage.some((entry) => entry.label.toLowerCase() === codeKey);
  const alreadyApplied = codeKey !== "" && appliedKeys.has(codeKey);
  const starter = cleanedCode !== "" && isStarterDietaryLabel(cleanedCode);
  // A vocabulary code is ticked, not re-added — unless it is a custom code
  // with a freshly typed meaning, which only stores the explanation.
  const canAdd =
    cleanedCode !== "" &&
    !alreadyApplied &&
    (!inVocabulary || (!starter && cleanDietaryLabel(meaning) !== ""));

  function handleAdd() {
    if (!canAdd) return;
    onAddNew(cleanedCode, cleanDietaryLabel(meaning));
    setCode("");
    setMeaning("");
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-scrim p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Dietary labels"
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-line-200 bg-surface-base p-4 focus:outline-none"
      >
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-sm font-semibold text-ink-900">Dietary labels</h2>
          <button
            type="button"
            aria-label="Close label picker"
            onClick={onClose}
            className={smallButton}
          >
            ✕
          </button>
        </div>
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
          {usage.map((entry) => {
            const checked = appliedKeys.has(entry.label.toLowerCase());
            const explanation = dietaryLabelMeaning(doc, entry.label);
            return (
              <li key={entry.label}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-50 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-700">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(entry.label, !checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-300 accent-accent-700"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium text-ink-900">{entry.label}</span>
                      <span className="text-[11px] tabular-nums text-ink-500">
                        {entry.count === 0
                          ? "Unused starter"
                          : `On ${entry.count} ${entry.count === 1 ? "dish" : "dishes"}`}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-ink-500">
                      {explanation ?? "No explanation yet."}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 border-t border-line-100 pt-3">
          <p className="text-xs font-semibold text-ink-700">New label</p>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <label className="block text-xs text-ink-600">
              Code
              <input
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="e.g. low-alcohol"
                className="mt-0.5 w-full rounded-lg border border-line-300 bg-surface-base px-2 py-1.5 text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent-700 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-ink-600">
              Meaning
              <input
                type="text"
                value={meaning}
                onChange={(event) => setMeaning(event.target.value)}
                placeholder={starter ? "Dictionary meaning applies" : "What it means to a diner"}
                className="mt-0.5 w-full rounded-lg border border-line-300 bg-surface-base px-2 py-1.5 text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent-700 focus:outline-none"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                disabled={!canAdd}
                onClick={handleAdd}
                className={`${smallButton} w-full sm:w-auto`}
              >
                Add
              </button>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-ink-500">
            {alreadyApplied
              ? "This dish already carries that label."
              : inVocabulary && (starter || cleanDietaryLabel(meaning) === "")
                ? "Already in the vocabulary — tick it above."
                : starter
                  ? "A starter code: the dictionary meaning applies."
                  : "Custom codes store their meaning on this menu."}
          </p>
        </div>
      </div>
    </div>
  );
}
