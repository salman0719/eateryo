/**
 * Step 11 of the redesign: drop math for the Reorder tab (SPEC §4b/§8.11).
 *
 * HTML5 drag-and-drop reports a dragged row and the row + edge it was
 * dropped on. This turns that into the post-removal insertion index the
 * move helpers (`moveCategory`, `moveItem`) take — or `null` when the drop
 * changes nothing, so the editor never marks a clean document dirty.
 *
 * Pure function, no DOM: the component owns the drag events and commits.
 */

export type DropEdge = "before" | "after";

/**
 * Where `draggedId` lands when dropped on `targetId` at `edge`.
 *
 * `targetId` null means the list end. Unknown ids throw, matching the move
 * helpers. Dropping a row onto itself — or onto the neighbour it already
 * precedes/follows — is a no-op and returns `null`.
 */
export function dropInsertIndex(
  ids: readonly string[],
  draggedId: string,
  targetId: string | null,
  edge: DropEdge
): number | null {
  const from = ids.indexOf(draggedId);
  if (from === -1) throw new Error(`Unknown row id: ${draggedId}`);
  if (targetId === draggedId) return null;
  if (targetId === null) {
    // Already last: the end drop changes nothing.
    return from === ids.length - 1 ? null : ids.length - 1;
  }
  const target = ids.indexOf(targetId);
  if (target === -1) throw new Error(`Unknown row id: ${targetId}`);
  // Removal shifts everything after `from` down one; the target's index in
  // the shortened list decides the insertion point.
  const shifted = target > from ? target - 1 : target;
  const at = edge === "before" ? shifted : shifted + 1;
  return at === from ? null : at;
}
