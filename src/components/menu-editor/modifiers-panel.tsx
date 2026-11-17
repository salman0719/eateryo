"use client";

import { useMemo, useState } from "react";

import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  addModifierTemplate,
  applyModifierTemplate,
  deleteModifierTemplate,
  dishesMissingTemplate,
  refreshDishesFromTemplate,
  updateModifierTemplate,
} from "@/features/menu/modifier-templates";
import type { MenuDocument, MenuModifierTemplate } from "@/features/menu/schema";

import { OptionGroupForm } from "./option-group-form";

const smallButton =
  "rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700";

interface ModifiersPanelProps {
  doc: MenuDocument;
  canManage: boolean;
  onChange: (next: MenuDocument) => void;
  /** Shown as an ✕ beside the heading when the panel lives in a dialog. */
  onClose?: () => void;
}

/** One-line shape of a template: "Required · 1–3 · 4 choices". */
function describeTemplate(template: MenuModifierTemplate): string {
  const range =
    template.max === null
      ? template.min === 0
        ? "Any number"
        : `At least ${template.min}`
      : template.min === template.max
        ? template.min === 1
          ? "One"
          : `Exactly ${template.min}`
        : `${template.min}–${template.max}`;
  const parts: string[] = [template.min > 0 ? "Required" : "Optional", range];
  parts.push(`${template.choices.length} ${template.choices.length === 1 ? "choice" : "choices"}`);
  return parts.join(" · ");
}

/**
 * The reusable-modifiers library: define a group once (sauces, toppings),
 * apply it to many dishes, and push edits out explicitly. Applying copies —
 * dishes never reference the template — so a later dish tweak can't leak
 * into its siblings, and deleting a template never rewrites a dish.
 */
export function ModifiersPanel({ doc, canManage, onChange, onClose }: ModifiersPanelProps) {
  const { confirm, dialog } = useConfirm();
  const [editingName, setEditingName] = useState<string | null>(null);
  const [applyingName, setApplyingName] = useState<string | null>(null);
  const [applyCategoryId, setApplyCategoryId] = useState<string>("");
  const [applySelection, setApplySelection] = useState<ReadonlySet<string> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const templates = doc.modifierTemplates;
  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const category of doc.categories) {
      for (const item of category.items) {
        for (const group of item.options) counts.set(group.name, (counts.get(group.name) ?? 0) + 1);
      }
    }
    return counts;
  }, [doc]);

  if (!canManage) return null;

  function report(message: string) {
    setNotice(message);
    setError(null);
  }

  function fail(message: string) {
    setError(message);
    setNotice(null);
  }

  function handleAdd() {
    try {
      const base = "New add-on set";
      let name = base;
      let n = 2;
      while (templates.some((template) => template.name === name)) name = `${base} ${n++}`;
      onChange(
        addModifierTemplate(doc, {
          name,
          choices: [{ name: "New choice", priceDelta: null }],
        })
      );
      setEditingName(name);
      setNotice(null);
      setError(null);
    } catch (thrown) {
      fail(thrown instanceof Error ? thrown.message : "Could not add the set.");
    }
  }

  async function handleDelete(name: string) {
    const used = usageCounts.get(name) ?? 0;
    const ok = await confirm({
      message:
        used > 0
          ? `Delete the “${name}” set? The ${used} ${used === 1 ? "dish" : "dishes"} already using it keep their copies.`
          : `Delete the “${name}” set?`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      onChange(deleteModifierTemplate(doc, name));
      if (editingName === name) setEditingName(null);
      if (applyingName === name) setApplyingName(null);
      report(`Deleted “${name}”. Dish copies were left in place.`);
    } catch (thrown) {
      fail(thrown instanceof Error ? thrown.message : "Could not delete the set.");
    }
  }

  function handleRefresh(name: string) {
    try {
      const { doc: next, updatedCount } = refreshDishesFromTemplate(doc, name);
      onChange(next);
      report(
        updatedCount === 1
          ? `“${name}” pushed to 1 dish.`
          : `“${name}” pushed to ${updatedCount} dishes.`
      );
    } catch (thrown) {
      fail(thrown instanceof Error ? thrown.message : "Could not update the dishes.");
    }
  }

  function openApply(name: string) {
    setApplyingName(name);
    setApplyCategoryId("");
    setApplySelection(null);
    setNotice(null);
    setError(null);
  }

  function candidateDishes(name: string) {
    const candidates = dishesMissingTemplate(doc, name);
    return applyCategoryId
      ? candidates.filter((dish) => dish.categoryId === applyCategoryId)
      : candidates;
  }

  function handleApply(name: string) {
    try {
      const candidates = candidateDishes(name);
      const ids =
        applySelection === null
          ? candidates.map((dish) => dish.itemId)
          : candidates.map((dish) => dish.itemId).filter((id) => applySelection.has(id));
      if (ids.length === 0) {
        fail("Tick at least one dish first.");
        return;
      }
      onChange(applyModifierTemplate(doc, name, ids));
      setApplySelection(null);
      report(
        ids.length === 1 ? `“${name}” added to 1 dish.` : `“${name}” added to ${ids.length} dishes.`
      );
    } catch (thrown) {
      fail(thrown instanceof Error ? thrown.message : "Could not apply the set.");
    }
  }

  function handleTemplateChange(previousName: string, next: MenuModifierTemplate) {
    try {
      const { name: nextName, ...rest } = next;
      onChange(updateModifierTemplate(doc, previousName, { ...rest, name: nextName }));
      if (nextName !== previousName) setEditingName(nextName);
      setError(null);
    } catch (thrown) {
      fail(thrown instanceof Error ? thrown.message : "Could not save the set.");
    }
  }

  return (
    <section
      aria-label="Add-on sets"
      className="rounded-2xl border border-line-200 bg-surface-base p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-sm font-semibold text-ink-900">Add-on sets</h2>
        <span className="flex-1" />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close add-on sets"
            className={smallButton}
          >
            ✕
          </button>
        )}
        <p className="text-xs text-ink-500">
          Define sauces and toppings once, apply them to many dishes. Applying copies the group —
          later dish tweaks stay on that dish until you push an update.
        </p>
      </div>
      {notice && (
        <p role="status" className="mt-2 text-xs font-medium text-success-800">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-danger-800">
          {error}
        </p>
      )}
      {templates.length === 0 ? (
        <p className="mt-2 text-xs text-ink-500">
          None yet — e.g. define “Pizza sauces” once, then apply it to every pizza below.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {templates.map((template) => {
            const used = usageCounts.get(template.name) ?? 0;
            const editing = editingName === template.name;
            const applying = applyingName === template.name;
            const candidates = applying ? candidateDishes(template.name) : [];
            const checked =
              applySelection === null
                ? new Set(candidates.map((dish) => dish.itemId))
                : applySelection;
            return (
              <li
                key={template.name}
                className="rounded-xl border border-line-200 bg-surface-base p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium text-ink-900">
                    {template.name}
                    <span className="ml-2 text-xs font-normal text-ink-500">
                      {describeTemplate(template)} · on {used} {used === 1 ? "dish" : "dishes"}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => (editing ? setEditingName(null) : setEditingName(template.name))}
                    className={smallButton}
                  >
                    {editing ? "Done" : "Edit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => (applying ? setApplyingName(null) : openApply(template.name))}
                    className={smallButton}
                  >
                    {applying ? "Close" : "Apply…"}
                  </button>
                  {used > 0 && (
                    <button
                      type="button"
                      onClick={() => handleRefresh(template.name)}
                      title="Copy this definition onto every dish already carrying it"
                      className={smallButton}
                    >
                      Update {used} {used === 1 ? "dish" : "dishes"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleDelete(template.name)}
                    className="rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
                  >
                    Delete
                  </button>
                </div>
                {editing && (
                  <div className="mt-3">
                    <ul className="space-y-3">
                      <OptionGroupForm
                        group={template}
                        onChange={(next) => handleTemplateChange(template.name, next)}
                        onRemove={() => void handleDelete(template.name)}
                        removeLabel={`Delete add-on set ${template.name}`}
                      />
                    </ul>
                  </div>
                )}
                {applying && (
                  <div className="mt-3 rounded-xl border border-line-200 bg-surface-50 p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs text-ink-600">
                        Dishes
                        <select
                          value={applyCategoryId}
                          onChange={(event) => {
                            setApplyCategoryId(event.target.value);
                            setApplySelection(null);
                          }}
                          className="mt-1 w-full rounded-lg border border-line-300 bg-surface-base px-2 py-1.5 text-xs text-ink-700 focus:border-accent-700 focus:outline-none sm:w-auto"
                        >
                          <option value="">Whole menu</option>
                          {doc.categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="flex-1" />
                      <button
                        type="button"
                        disabled={checked.size === 0}
                        onClick={() => handleApply(template.name)}
                        className={`${smallButton} disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        Apply to {checked.size} {checked.size === 1 ? "dish" : "dishes"}
                      </button>
                    </div>
                    {candidates.length === 0 ? (
                      <p className="mt-2 text-xs text-ink-500">
                        Every {applyCategoryId ? "dish in this category" : "dish"} already carries “
                        {template.name}”.
                      </p>
                    ) : (
                      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                        {candidates.map((dish) => (
                          <li key={dish.itemId}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs text-ink-700 hover:bg-surface-100">
                              <input
                                type="checkbox"
                                checked={checked.has(dish.itemId)}
                                onChange={(event) => {
                                  const next = new Set(checked);
                                  if (event.target.checked) next.add(dish.itemId);
                                  else next.delete(dish.itemId);
                                  setApplySelection(next);
                                }}
                                className="h-4 w-4 rounded border-line-300 accent-accent-700"
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {dish.itemName}
                                <span className="text-ink-500"> · {dish.categoryName}</span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={handleAdd} className={`${smallButton} mt-3`}>
        + New add-on set
      </button>
      {dialog}
    </section>
  );
}
