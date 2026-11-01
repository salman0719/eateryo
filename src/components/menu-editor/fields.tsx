"use client";

import { useState } from "react";
import { flushSync } from "react-dom";

import {
  dedupeDietaryLabels,
  sameDietaryLabels,
  suggestDietaryLabels,
} from "@/features/menu/dietary-labels";

/**
 * Inputs that commit on blur/Enter and revert on invalid values, so the
 * document only ever holds valid data (helpers throw on empty names, and
 * saves validate with Zod). Parents can assume committed values are valid.
 */

interface CommitInputProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  validate?: (value: string) => string | null;
  placeholder?: string;
  multiline?: boolean;
  inputClassName?: string;
}

const baseInput =
  "w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 " +
  // Textareas get no resize handle on touch (undraggable); desktop keeps vertical resize.
  "resize-none focus:border-amber-700 focus:outline-none sm:resize-y";

export function CommitInput({
  label,
  value,
  onCommit,
  validate,
  placeholder,
  multiline,
  inputClassName,
}: CommitInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function commit(next: string) {
    const problem = validate ? validate(next) : next.trim() ? null : "Must not be empty.";
    // Flush synchronously: a blur is almost always followed by a button click
    // (same tick, batched by React). Without this, the click handler would
    // close over pre-commit state and silently discard this edit.
    flushSync(() => {
      if (problem) {
        setError(problem);
        setDraft(null);
        return;
      }
      setError(null);
      setDraft(null);
      if (next !== value) {
        try {
          onCommit(next);
        } catch {
          setError("That value was rejected.");
        }
      }
    });
  }

  const shared = {
    "aria-label": label,
    placeholder,
    value: draft ?? value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(event.target.value);
      if (error) setError(null);
    },
    onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      commit(event.target.value),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" && !multiline) {
        (event.target as HTMLElement).blur();
      }
      if (event.key === "Escape") {
        setDraft(null);
        setError(null);
        (event.target as HTMLElement).blur();
      }
    },
    className: [baseInput, error ? "border-red-500" : "", inputClassName ?? ""].join(" "),
  };

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>
      {multiline ? <textarea rows={2} {...shared} /> : <input type="text" {...shared} />}
      {error && <span className="mt-0.5 block text-xs text-red-700">{error}</span>}
    </label>
  );
}

interface CommitTagsProps {
  label: string;
  value: readonly string[];
  onCommit: (next: string[]) => void;
  /** Ranked candidates; offered as one-click additions under the input. */
  suggestions?: readonly string[];
  hint?: string;
  placeholder?: string;
}

/**
 * Tag input for a list of short strings (010). Commits on Enter, on blur and
 * on every add/remove, with the same `flushSync` contract as `CommitInput` so
 * a click in the same tick sees the committed list instead of stale props.
 *
 * A label is never split on commas: one that contains a comma survives a round
 * trip intact, which the old comma string could not promise.
 */
export function CommitTags({
  label,
  value,
  onCommit,
  suggestions = [],
  hint,
  placeholder,
}: CommitTagsProps) {
  const [draft, setDraft] = useState("");
  // Render the deduped list: a document saved before this was a tag input (a
  // CSV import can hold `vegan` twice) must not produce duplicate keys.
  const tags = dedupeDietaryLabels(value);
  const offered = suggestDietaryLabels(suggestions, { exclude: tags, query: draft, limit: 8 });

  function commit(next: readonly string[]) {
    flushSync(() => {
      setDraft("");
      const cleaned = dedupeDietaryLabels(next);
      if (sameDietaryLabels(cleaned, tags)) return;
      onCommit(cleaned);
    });
  }

  return (
    <div role="group" aria-label={label}>
      {/* The keys live on the label row: an instruction the owner sees before
          typing, without taking a line of its own. */}
      <span className="mb-1 flex flex-wrap items-baseline gap-x-1.5 text-xs">
        <span className="font-medium text-stone-600">{label}</span>
        <span className="text-stone-500">Enter, Tab or comma adds</span>
      </span>
      {tags.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag}>
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 py-0.5 pr-1 pl-2.5 text-xs font-medium text-green-900">
                {tag}
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  // mousedown, not click: the input's blur would otherwise
                  // commit a draft and leave this handler with stale props.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(tags.filter((candidate) => candidate !== tag));
                  }}
                  className="rounded-full px-1 leading-none text-green-900/70 hover:text-green-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-700"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <input
        type="text"
        aria-label={label}
        placeholder={placeholder ?? "Add a label…"}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          if (event.target.value.trim()) commit([...tags, event.target.value]);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            // A comma must not land in the field, and Enter must not submit a
            // surrounding form.
            event.preventDefault();
            if (draft.trim()) commit([...tags, draft]);
          } else if (event.key === "Tab") {
            // Commit, then let Tab do its job: keyboard users must still be
            // able to leave the field by tabbing.
            if (draft.trim()) commit([...tags, draft]);
          } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
            commit(tags.slice(0, -1));
          } else if (event.key === "Escape") {
            setDraft("");
          }
        }}
        className={baseInput}
      />
      {offered.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-stone-500">
            {draft.trim() ? "Matching" : "Already used"}:
          </span>
          {offered.map((candidate) => (
            <button
              key={candidate}
              type="button"
              // mousedown + preventDefault keeps focus in the input, so adding
              // a suggestion does not fight the blur.
              onMouseDown={(event) => {
                event.preventDefault();
                commit([...tags, candidate]);
              }}
              className="rounded-full border border-dashed border-stone-300 px-2 py-0.5 text-[11px] text-stone-600 hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              + {candidate}
            </button>
          ))}
        </div>
      )}
      {hint && <span className="mt-1 block text-[11px] text-stone-500">{hint}</span>}
    </div>
  );
}

interface CommitNumberProps {
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  placeholder?: string;
  inputClassName?: string;
}

export function CommitNumber({
  label,
  value,
  onCommit,
  placeholder,
  inputClassName,
}: CommitNumberProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function commit(raw: string) {
    // See CommitInput: flush synchronously so a following click in the same
    // tick observes the committed value instead of stale state.
    flushSync(() => {
      const trimmed = raw.trim();
      if (trimmed === "") {
        setError(null);
        setDraft(null);
        if (value !== null) onCommit(null);
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Enter a price of 0 or more, or leave blank.");
        setDraft(null);
        return;
      }
      setError(null);
      setDraft(null);
      const rounded = Math.round(parsed * 100) / 100;
      if (rounded !== value) onCommit(rounded);
    });
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        aria-label={label}
        placeholder={placeholder}
        value={draft ?? (value === null ? "" : String(value))}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLElement).blur();
          if (event.key === "Escape") {
            setDraft(null);
            setError(null);
            (event.target as HTMLElement).blur();
          }
        }}
        className={[baseInput, error ? "border-red-500" : "", inputClassName ?? ""].join(" ")}
      />
      {error && <span className="mt-0.5 block text-xs text-red-700">{error}</span>}
    </label>
  );
}
