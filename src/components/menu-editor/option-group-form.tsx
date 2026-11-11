"use client";

import type { MenuOption } from "@/features/menu/schema";

import { CommitInput, CommitNumber } from "./fields";

const smallButton =
  "rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700";

interface OptionGroupFormProps {
  /** The group being edited; every control reports a whole new group value. */
  group: MenuOption;
  onChange: (next: MenuOption) => void;
  onRemove: () => void;
  /** Accessible label for the remove button, naming the group. */
  removeLabel: string;
}

/**
 * One option-group card (rules + choices), shared by the dish form and the
 * reusable-modifiers panel so the two can never drift: a template edits
 * exactly what a dish's copy edits.
 */
export function OptionGroupForm({ group, onChange, onRemove, removeLabel }: OptionGroupFormProps) {
  return (
    <li className="rounded-lg border border-line-200 bg-surface-base p-2.5">
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <CommitInput
          label="Option group"
          value={group.name}
          onCommit={(name) => onChange({ ...group, name: name.trim() })}
        />
        <button type="button" aria-label={removeLabel} onClick={onRemove} className={smallButton}>
          ✕
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_90px_90px]">
        <label className="flex items-center gap-2 rounded-lg border border-line-200 bg-surface-base px-2.5 py-2 text-xs text-ink-700">
          <input
            type="checkbox"
            checked={group.required}
            onChange={(event) => onChange({ ...group, required: event.target.checked })}
            className="h-4 w-4 rounded accent-accent-700"
          />
          Required
        </label>
        <label className="text-xs text-ink-600">
          Picks
          <select
            value={group.selection}
            onChange={(event) =>
              onChange({ ...group, selection: event.target.value as "one" | "many" })
            }
            className="mt-1 w-full rounded-lg border border-line-300 bg-surface-base px-2 py-1.5 text-xs text-ink-700 focus:border-accent-700 focus:outline-none"
          >
            <option value="one">One</option>
            <option value="many">Many</option>
          </select>
        </label>
        <CommitNumber
          label="Min"
          value={group.min}
          placeholder="0"
          onCommit={(min) =>
            onChange({ ...group, min: min === null ? 0 : Math.max(0, Math.trunc(min)) })
          }
        />
        <CommitNumber
          label="Max"
          value={group.max}
          placeholder="No limit"
          onCommit={(max) =>
            onChange({ ...group, max: max === null ? null : Math.max(1, Math.trunc(max)) })
          }
        />
      </div>
      {group.choices.length === 0 && (
        <p className="mt-2 rounded-lg bg-warning-50 px-2.5 py-1.5 text-xs text-warning-900">
          No choices yet — add at least one, or diners can never satisfy
          {group.required ? " this required" : " this"} group.
        </p>
      )}
      <ul className="mt-2 space-y-2">
        {group.choices.map((choice, cIndex) => (
          <li
            key={`${choice.name}-${cIndex}`}
            className="grid grid-cols-1 items-end gap-2 pl-3 sm:grid-cols-[1fr_110px_auto]"
          >
            <CommitInput
              label="Choice"
              value={choice.name}
              onCommit={(name) =>
                onChange({
                  ...group,
                  choices: group.choices.map((c, j) =>
                    j === cIndex ? { ...c, name: name.trim() } : c
                  ),
                })
              }
            />
            <CommitNumber
              label="Extra"
              value={choice.priceDelta}
              onCommit={(priceDelta) =>
                onChange({
                  ...group,
                  choices: group.choices.map((c, j) => (j === cIndex ? { ...c, priceDelta } : c)),
                })
              }
            />
            <button
              type="button"
              aria-label={`Remove choice ${choice.name}`}
              onClick={() =>
                onChange({ ...group, choices: group.choices.filter((_, j) => j !== cIndex) })
              }
              className={smallButton}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() =>
          onChange({
            ...group,
            choices: [...group.choices, { name: "New choice", priceDelta: null }],
          })
        }
        className={`${smallButton} mt-2`}
      >
        + Add choice
      </button>
    </li>
  );
}
