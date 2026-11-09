"use client";

import {
  workspaceLabel,
  type Workspace,
} from "@/features/tenancy/workspace";

/**
 * Which café-and-role the shell is acting in.
 *
 * Shown only when one sign-in holds more than one membership: with a single
 * café there is no context to confuse, and the header already names the
 * account. The server resolves each membership's capabilities, so switching
 * here cannot widen what the caller may do — it only chooses which answer
 * the shell asks.
 */
export function WorkspaceSwitcher({
  workspaces,
  active,
  onSwitch,
}: {
  workspaces: Workspace[];
  /** The membership in force; null while the account details are unread. */
  active: Workspace | null;
  onSwitch: (key: string) => void;
}) {
  if (!active || workspaces.length < 2) return null;

  return (
    <div data-print-hide className="border-b border-line-200 bg-surface-50">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <label
          htmlFor="workspace-switcher"
          className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase"
        >
          Acting as
        </label>
        <select
          id="workspace-switcher"
          value={active.key}
          onChange={(event) => onSwitch(event.target.value)}
          className="max-w-full rounded-lg border border-line-300 bg-surface-base px-2.5 py-1 text-xs font-medium text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          {workspaces.map((workspace) => (
            <option key={workspace.key} value={workspace.key}>
              {workspaceLabel(workspace)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
