"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { NewOrdersBadge } from "@/components/orders/new-orders-badge";
import {
  BookIcon,
  CameraIcon,
  ChecklistIcon,
  GridIcon,
  PanelLeftIcon,
  ReceiptIcon,
  SlidersIcon,
  SparkleIcon,
} from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import type { AppSection, AppSectionId } from "@/features/navigation/routes";

import {
  applySidebarMode,
  currentSidebarMode,
  SIDEBAR_CHANGE_EVENT,
  SIDEBAR_EXPANDED_MIN_WIDTH,
  storeSidebarMode,
  type SidebarMode,
} from "./sidebar-preference";

/** One row of the editor's contextual outline: a section of the open menu. */
export interface SidebarOutlineItem {
  id: string;
  name: string;
  itemCount: number;
}

interface AppSidebarProps {
  /**
   * Top-level destinations, from `availableSections` (the capability table).
   * Empty while the session is unknown.
   */
  sections: AppSection[];
  activeSection: AppSectionId | null;
  /** The session read has not answered: identity stays a placeholder, never "Sign in". */
  sessionPending: boolean;
  signedIn: boolean;
  email: string | null;
  onNavigate: (section: AppSectionId) => void;
  onSignOut: () => void;
  /**
   * The open menu's sections while the edit workspace is showing. This is the
   * contextual half of the column: the space earns itself by jumping around a
   * long menu, not by repeating the nav.
   */
  outline?: SidebarOutlineItem[] | null;
  /** Stable list identity; the section observer re-attaches only when it changes. */
  outlineKey?: string;
  onOutlineSelect?: (categoryId: string) => void;
  /**
   * Launch-checklist progress while it is still unfinished. Null hides the
   * row: signed out, not read yet, unreadable, or already complete — the
   * sidebar should not keep advertising a finished checklist.
   */
  launch?: { done: number; total: number } | null;
  /**
   * The account's menu list is still being read, so the My menus count is not
   * known yet. A placeholder holds its place instead of a smaller number that
   * is about to grow.
   */
  menusPending?: boolean;
}

function SectionIcon({ id, size = 18 }: { id: AppSectionId; size?: number }) {
  switch (id) {
    case "capture":
      return <CameraIcon size={size} />;
    case "library":
      return <BookIcon size={size} />;
    case "orders":
      return <ReceiptIcon size={size} />;
    case "assistant":
      return <SparkleIcon size={size} />;
    case "tables":
      return <GridIcon size={size} />;
    case "settings":
      return <SlidersIcon size={size} />;
  }
}

/**
 * The applied mode is DOM state (see `sidebar-preference.ts`), so the toggle
 * subscribes to it rather than copying it into an effect. The width query
 * matters only while nobody has chosen: resizing across xl moves the default.
 */
function subscribeSidebarMode(onChange: () => void): () => void {
  const media = window.matchMedia(`(min-width: ${SIDEBAR_EXPANDED_MIN_WIDTH}px)`);
  media.addEventListener("change", onChange);
  window.addEventListener(SIDEBAR_CHANGE_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, onChange);
  };
}

const itemBase =
  "app-sidebar-item relative flex w-full items-center gap-2.5 rounded-lg text-sm font-medium transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700";

/**
 * The app's left column: brand, destinations, the open menu's sections, and
 * the account. A tablet-width window gets a 72px icon rail; an xl window gets
 * the 260px column; either can be toggled and the choice is remembered
 * (see `sidebar-preference.ts`), so nobody is stuck with a column they are
 * not using.
 *
 * Colours are role tokens only: `surface` for the column and hover states,
 * `line` for the rules, `ink` for text, `accent` for the current destination.
 * Print (`data-print-hide`) drops the whole column so table cards print clean.
 */
export function AppSidebar({
  sections,
  activeSection,
  sessionPending,
  signedIn,
  email,
  onNavigate,
  onSignOut,
  outline,
  outlineKey = "",
  onOutlineSelect,
  launch,
  menusPending = false,
}: AppSidebarProps) {
  // The boot script has already applied a saved mode before paint, so the
  // toggle reads the live attribute instead of mirroring it in state. The
  // server snapshot is only a placeholder; the client subscribes immediately.
  const mode = useSyncExternalStore(
    subscribeSidebarMode,
    () => currentSidebarMode(window.innerWidth),
    () => "expanded" as const
  );
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);

  // Highlight the section nearest the top of the viewport as the editor
  // scrolls. Only the edit workspace tags its sections (`data-menu-section`),
  // so reorder/preview simply find nothing and leave the outline quiet.
  useEffect(() => {
    if (!outlineKey) return;
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-menu-section]")
    );
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (first) {
          setActiveOutlineId(first.target.getAttribute("data-menu-section"));
        }
      },
      // A section counts as current once its top band clears the viewport's
      // top edge and before it has scrolled into the lower half.
      { rootMargin: "-64px 0px -55% 0px" }
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [outlineKey]);

  function toggle() {
    const next: SidebarMode = mode === "expanded" ? "rail" : "expanded";
    applySidebarMode(next);
    storeSidebarMode(next);
    window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
  }

  return (
    <aside
      data-print-hide
      aria-label="Eateryo"
      className="app-sidebar sticky top-0 hidden h-screen shrink-0 flex-col self-start border-r border-line-200 bg-surface-base sm:flex"
    >
      <div className="app-sidebar-brand flex items-center gap-2.5 px-3 py-4">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-700 text-base font-bold text-on-accent"
        >
          E
        </span>
        <span className="app-sidebar-label min-w-0">
          <span className="block truncate text-sm font-bold tracking-tight text-ink-900">
            Eateryo
          </span>
          <span className="block truncate text-xs text-ink-500">Menus · tables · orders</span>
        </span>
      </div>

      <nav
        aria-label="Sections"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3"
      >
        {/* The session read has not answered, so the destination list is not
            known yet: hold its shape instead of an empty column that fills
            in a moment later. Five rows is a signed-in account's list. */}
        {sessionPending ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-0.5">
            <span className="sr-only">Loading navigation…</span>
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className={`${itemBase} min-h-[40px] px-2.5 py-1.5`}>
                <span
                  aria-hidden="true"
                  className="flex w-5 shrink-0 items-center justify-center"
                >
                  <Skeleton className="h-5 w-5 rounded-md" />
                </span>
                <span aria-hidden="true" className="app-sidebar-label min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-24" />
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {sections.map((section) => {
          const active = section.id === activeSection;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onNavigate(section.id)}
              aria-current={active ? "page" : undefined}
              title={section.label}
              className={`${itemBase} min-h-[40px] px-2.5 py-1.5 ${
                active
                  ? "bg-accent-50 text-accent-900"
                  : "text-ink-600 hover:bg-surface-50 hover:text-ink-900"
              }`}
            >
              <span className="flex w-5 shrink-0 items-center justify-center">
                <SectionIcon id={section.id} />
              </span>
              <span
                aria-hidden="true"
                className="app-sidebar-label min-w-0 flex-1 truncate text-left"
              >
                {section.label}
              </span>
              {section.id === "library" && menusPending ? (
                <span aria-hidden="true" className="app-sidebar-label shrink-0">
                  <Skeleton className="h-4 w-6 rounded-full" />
                </span>
              ) : section.count ? (
                <span
                  aria-hidden="true"
                  className="app-sidebar-label rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600"
                >
                  {section.count}
                </span>
              ) : null}
              {/* The icon and visible label are decoration for assistive tech;
                  this is the name in both the rail and the expanded column. */}
              <span className="sr-only">
                {section.id === "library" && menusPending
                  ? `${section.label}, loading your menus`
                  : section.count
                    ? `${section.label}, ${section.count} menus`
                    : section.label}
              </span>
              {section.id === "orders" ? <NewOrdersBadge tone="rail" /> : null}
            </button>
          );
        })}

        {launch && launch.done < launch.total ? (
          <a
            href="/launch"
            className={`${itemBase} mt-1 min-h-[40px] px-2.5 py-1.5 text-ink-600 hover:bg-surface-50 hover:text-ink-900`}
          >
            <span className="flex w-5 shrink-0 items-center justify-center">
              <ChecklistIcon />
            </span>
            <span aria-hidden="true" className="app-sidebar-label min-w-0 flex-1 truncate text-left">
              Launch checklist
            </span>
            <span
              aria-hidden="true"
              className="app-sidebar-label rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600"
            >
              {launch.done}/{launch.total}
            </span>
            {/* The rail hides the visible label; this keeps the progress in
                the name at every width. */}
            <span className="sr-only">
              Launch checklist, {launch.done} of {launch.total} steps done
            </span>
          </a>
        ) : null}

        {outline && outline.length > 0 ? (
          <div className="app-sidebar-label mt-3 border-t border-line-200 pt-3">
            <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
              In this menu
            </p>
            <ul className="flex flex-col gap-0.5">
              {outline.map((item) => {
                const current = item.id === activeOutlineId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onOutlineSelect?.(item.id)}
                      aria-current={current ? "true" : undefined}
                      className={`flex min-h-[32px] w-full items-center gap-2 rounded-lg px-2.5 py-1 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 ${
                        current
                          ? "bg-surface-100 font-semibold text-ink-900"
                          : "text-ink-600 hover:bg-surface-50 hover:text-ink-900"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <span className="shrink-0 text-[11px] font-normal text-ink-400">
                        {item.itemCount}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </nav>

      <div className="app-sidebar-label border-t border-line-200 px-3 py-3 text-xs">
        {sessionPending ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-2">
            <span className="sr-only">Checking your session…</span>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-20 rounded-lg" />
          </div>
        ) : signedIn ? (
          <>
            <p className="truncate text-[11px] text-ink-500" title="Signed in as">
              {email}
            </p>
            <button
              type="button"
              onClick={onSignOut}
              className="mt-1 rounded-lg border border-line-300 px-2.5 py-1 text-[11px] font-medium text-ink-600 transition-colors hover:bg-surface-50 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              Sign out
            </button>
          </>
        ) : (
          <a
            href="/sign-in"
            className="inline-flex rounded-lg border border-line-300 px-2.5 py-1 font-medium text-ink-600 transition-colors hover:bg-surface-50 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            Sign in
          </a>
        )}
        {/* Signed in, the launch checklist row above replaces this link: a
            returning owner needs progress, not an invitation. Signed out it
            stays next to Sign in, where it still is the way in. */}
        {!signedIn && !sessionPending ? (
          <a
            href="/launch"
            className="mt-2 block rounded-lg px-1 py-1 font-semibold text-warning-800 transition-colors hover:bg-accent-50 hover:text-accent-900"
          >
            Get started
          </a>
        ) : null}
      </div>

      {/* The height is the shared --app-bottom-bar-height token, the same one
          SiteFooter uses, so the sidebar's last rule meets the footer's on the
          same line: both columns end on the viewport bottom. */}
      <div className="flex h-[var(--app-bottom-bar-height)] items-center border-t border-line-200 px-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={mode === "expanded"}
          aria-label={mode === "expanded" ? "Collapse navigation" : "Expand navigation"}
          className={`${itemBase} min-h-[36px] px-2.5 py-1 text-xs text-ink-500 hover:bg-surface-50 hover:text-ink-900`}
        >
          <span className="flex w-5 shrink-0 items-center justify-center">
            <PanelLeftIcon size={18} className={mode === "expanded" ? "rotate-180" : undefined} />
          </span>
          <span aria-hidden="true" className="app-sidebar-label truncate">
            {mode === "expanded" ? "Collapse" : "Expand"}
          </span>
        </button>
      </div>
    </aside>
  );
}
