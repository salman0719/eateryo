"use client";

import type { ReactNode } from "react";

import { optionGroupConfigProblems } from "@/features/menu/option-groups";
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
  /** Optional row under the choices (e.g. the dish form's save-as-template). */
  footer?: ReactNode;
}

/**
 * One option-group card (rules + choices), shared by the dish form and the
 * reusable-modifiers panel so the two can never drift: a template edits
 * exactly what a dish's copy edits.
 */
export function OptionGroupForm({
  group,
  onChange,
  onRemove,
  removeLabel,
  footer,
}: OptionGroupFormProps) {
  // Unsatisfiable rules (min above max, min a single-pick group can never
  // reach) warn here, in both editors at once — the server would reject
  // every order, so the owner hears it first, from the screen that can fix it.
  const configProblems = optionGroupConfigProblems(group);
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
      <div className="mt-2 grid grid-cols-2 items-end gap-2">
        <CommitNumber
          label="Min"
          value={group.min}
          integer
          placeholder="0 — skippable"
          onCommit={(min) =>
            onChange({ ...group, min: min === null ? 0 : Math.max(0, Math.trunc(min)) })
          }
        />
        <CommitNumber
          label="Max"
          value={group.max}
          integer
          placeholder="No limit"
          onCommit={(max) =>
            onChange({ ...group, max: max === null ? null : Math.max(1, Math.trunc(max)) })
          }
        />
      </div>
      {/* Min is the required switch, so the badge is derived, never set:
          0 means the diner may skip, 1+ means they must pick that many. */}
      <p className="mt-1 text-[11px] text-ink-500">
        {group.min > 0 ? (
          <>Required — diners must pick {group.min === 1 ? "one" : `at least ${group.min}`}.</>
        ) : (
          <>Optional — diners may skip this.</>
        )}{" "}
        {group.max === 1 ? "Shows as single-pick." : "Shows as multi-pick."}
      </p>
      {group.choices.length === 0 && (
        <p className="mt-2 rounded-lg bg-warning-50 px-2.5 py-1.5 text-xs text-warning-900">
          No choices yet — add at least one, or diners can never satisfy this group.
        </p>
      )}
      {configProblems.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg bg-warning-50 px-2.5 py-1.5 text-xs text-warning-900">
          {configProblems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
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
      {footer}
    </li>
  );
}
