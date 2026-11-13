/**
 * "Move my menus to my account" (PHASE-2.md §3.4). Browser-only: it reads
 * local IndexedDB documents and creates server copies through the same
 * validated API the editor uses.
 *
 * Contract:
 * - One-way: local data is never modified in place; the server gains
 *   copies. Callers dissolve rows the server just accepted; skipped rows
 *   (already there) stay for the heal.
 * - Idempotent-ish: each document keeps its local id, so re-running the
 *   move skips menus that already exist on the server (409 menu_exists)
 *   instead of duplicating them.
 * - Honest: damaged local records and per-menu API failures are reported
 *   per menu, never silently dropped, and one failure never aborts the
 *   rest of the batch.
 */

import { getMenu, listMenus } from "@/features/menu/storage";

import { createServerMenu, SyncError, type MembershipAccess } from "./sync";

export interface MoveFailure {
  id: string;
  title: string;
  reason: string;
}

export interface MoveReport {
  /** Menu ids newly created on the server. */
  imported: string[];
  /** Menu ids that already existed on the server (safe to re-run). */
  skipped: string[];
  /** Menus that could not be moved, with a human-readable reason each. */
  failed: MoveFailure[];
  /**
   * The server's own access answer per imported menu. Adopt it — the create
   * call just proved the row lives on the account in the target café, so the
   * shell must not wait for a café-keyed read that may cover another café.
   */
  accessById: Partial<Record<string, MembershipAccess>>;
}

/** What happened to one local menu (per-row moves report it directly). */
export type MoveOutcome =
  | { status: "imported"; access: MembershipAccess }
  | { status: "skipped" }
  | { status: "failed"; reason: string };

function failureReason(error: unknown): string {
  if (error instanceof SyncError) {
    switch (error.code) {
      case "forbidden":
      case "not_found":
        return "You are not the owner of the restaurant you selected.";
      case "unauthorized":
        return "Your session expired before this menu was moved. Sign in again and re-run.";
      case "unavailable":
        return "The server was unreachable. Check your connection and try again.";
      default:
        return error.message;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Unexpected error.";
}

/**
 * Copy one local menu into the caller's restaurant on the server. Never
 * throws for per-menu problems (missing, damaged, or refused): the outcome
 * carries a reason the UI can show next to that row.
 */
export async function moveLocalMenuToAccount(
  restaurantId: string,
  menuId: string
): Promise<MoveOutcome> {
  try {
    const doc = await getMenu(menuId);
    // The document keeps its local id; the server adopts it as the row id.
    // The create answer carries the caller's access — thread it through so
    // the row never renders as on-account with no access ("View only").
    const created = await createServerMenu(restaurantId, doc);
    return { status: "imported", access: created.access };
  } catch (error) {
    if (error instanceof SyncError && error.code === "exists") return { status: "skipped" };
    return { status: "failed", reason: failureReason(error) };
  }
}

/**
 * Copy local menus into the caller's restaurant on the server. Pass `onlyIds`
 * to move just the visible browser-only rows — hidden rows belong to another
 * session and must never be swept into this account.
 * Returns which menus were imported, skipped (already there), or failed.
 */
export async function moveLocalMenusToAccount(
  restaurantId: string,
  onlyIds?: readonly string[]
): Promise<MoveReport> {
  const summaries = await listMenus();
  const wanted = onlyIds ? new Set(onlyIds) : null;
  const report: MoveReport = { imported: [], skipped: [], failed: [], accessById: {} };

  // Sequential on purpose: each menu is a validated round trip, and a
  // predictable order makes partial failures easy to read and re-run.
  for (const summary of summaries) {
    if (wanted && !wanted.has(summary.id)) continue;
    if (summary.corrupt) {
      report.failed.push({
        id: summary.id,
        title: summary.title,
        reason: "This menu is damaged and cannot be moved. Export or delete it first.",
      });
      continue;
    }
    const outcome = await moveLocalMenuToAccount(restaurantId, summary.id);
    if (outcome.status === "imported") {
      report.imported.push(summary.id);
      report.accessById[summary.id] = outcome.access;
    } else if (outcome.status === "skipped") report.skipped.push(summary.id);
    else report.failed.push({ id: summary.id, title: summary.title, reason: outcome.reason });
  }

  return report;
}
