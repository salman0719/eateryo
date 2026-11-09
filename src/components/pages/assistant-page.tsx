"use client";

import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { Skeleton } from "@/components/ui/skeleton";

export interface AssistantMenuOption {
  id: string;
  title: string;
}

export interface AssistantPageProps {
  signedIn: boolean;
  sessionPending: boolean;
  /** The release flags are still loading: hold a skeleton, not "unavailable". */
  pending: boolean;
  /** Whether the assistant is released to this account. */
  enabled: boolean;
  /** Whether edit proposals are released (a narrower flag). */
  proposalsEnabled: boolean;
  menusLoading: boolean;
  /** The active café's writable menus only: proposals never cross membership. */
  menus: AssistantMenuOption[];
  onBackToCapture: () => void;
}

export function AssistantPage({
  signedIn,
  sessionPending,
  pending,
  enabled,
  proposalsEnabled,
  menusLoading,
  menus,
  onBackToCapture,
}: AssistantPageProps) {
  if (pending) {
    return (
      <section
        role="status"
        aria-busy="true"
        aria-label="Loading the assistant"
        className="flex flex-col gap-3 rounded-2xl border border-line-200 bg-surface-base p-6"
      >
        <span className="sr-only">Loading the assistant…</span>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
      </section>
    );
  }
  if (enabled) {
    return (
      <AssistantPanel
        signedIn={signedIn}
        sessionPending={sessionPending}
        proposalsEnabled={proposalsEnabled}
        menusLoading={menusLoading}
        menus={menus}
      />
    );
  }
  // Unreachable through the UI — both navs hide the assistant when signed out
  // and the shell bounces a typed /assistant URL back to capture — so render
  // nothing while the bounce lands.
  if (!signedIn) return null;
  return (
    <section className="rounded-2xl border border-dashed border-line-300 bg-surface-base p-8 text-center">
      <h1 className="font-medium text-ink-900">Assistant isn’t available</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-600">
        The assistant isn’t released to this account yet. Everything else in Eateryo works as usual.
      </p>
      <button
        type="button"
        onClick={onBackToCapture}
        className="mt-4 rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
      >
        Back to capture
      </button>
    </section>
  );
}
