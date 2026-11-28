"use client";

import { useId, useState, type ReactNode } from "react";

import { Collapse } from "@/components/ui/collapse";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/ui/icons";
import { optionGroupConfigProblems, optionGroupShape } from "@/features/menu/option-groups";
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
 * One option-group mini-card (rules + choices), shared by the dish form and
 * the reusable-modifiers panel so the two can never drift: a template edits
 * exactly what a dish's copy edits.
 *
 * The header carries the derived shape ("Optional · 0–2 · 3 choices") with a
 * Check badge while the group is empty or unsatisfiable; the body holds the
 * name + min/max row, the derived rule sentence, and the choices.
 */
export function OptionGroupForm({
  group,
  onChange,
  onRemove,
  removeLabel,
  footer,
}: OptionGroupFormProps) {
  const [open, setOpen] = useState(true);
  const panelId = useId();
  // Unsatisfiable rules (min above max, min a single-pick group can never
  // reach) warn here, in both editors at once — the server would reject
  // every order, so the owner hears it first, from the screen that can fix it.
  const configProblems = optionGroupConfigProblems(group);
  const needsAttention = group.choices.length === 0 || configProblems.length > 0;
  return (
    <li className="overflow-hidden rounded-lg border border-line-200 bg-surface-base">
      <div className="flex items-center gap-1.5 bg-surface-50 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={panelId}
          title={open ? "Collapse this group" : "Expand this group"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line-300 bg-surface-base text-sm text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-900">
            {group.name || "Unnamed group"}
          </span>
          <span className="block truncate text-[11px] tabular-nums text-ink-500">
            {optionGroupShape(group)}
          </span>
        </span>
        {needsAttention && (
          <span className="shrink-0 rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-900">
            Check
          </span>
        )}
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className={`${smallButton} shrink-0`}
        >
          ✕
        </button>
      </div>
      <Collapse open={open}>
        <div id={panelId} className="p-2.5">
          <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_84px_84px]">
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <CommitInput
                label="Option group"
                value={group.name}
                onCommit={(name) => onChange({ ...group, name: name.trim() })}
              />
            </div>
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
                  label="Added price"
                  placeholder="0 if included"
                  value={choice.priceDelta}
                  onCommit={(priceDelta) =>
                    onChange({
                      ...group,
                      choices: group.choices.map((c, j) =>
                        j === cIndex ? { ...c, priceDelta } : c
                      ),
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
        </div>
      </Collapse>
    </li>
  );
}
