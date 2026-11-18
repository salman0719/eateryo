"use client";

import { useEffect, type ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { BrandBar } from "@/components/layout/brand-bar";
import { SiteFooter } from "@/components/layout/site-footer";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { BookIcon, CameraIcon, ChecklistIcon, MoreIcon, ReceiptIcon } from "@/components/ui/icons";
import { MonitorToasts } from "@/components/orders/monitor-toasts";
import { useSessionHint } from "@/features/session/use-session-hint";
import { NewOrdersBadge } from "@/components/orders/new-orders-badge";
import { OrderMonitorProvider, useOrderMonitor } from "@/features/orders/monitor";
import {
  sectionForScreen,
  type AppScreen,
  type AppSection,
  type AppSectionId,
  type MoreSheetRow,
  type PhoneTab,
} from "@/features/navigation/routes";
import type { Workspace } from "@/features/tenancy/workspace";

/**
 * The frame every signed-in (and signed-out) app screen sits in: the left
 * column, the brand row that stands in for it, the workspace switcher, the
 * content column and its footer, the phone tab bar, the More sheet, and the
 * order monitor's toasts.
 *
 * It is deliberately shaped as a layout, not a screen: the page owns its
 * content (passed as `children` and `notices`), while the frame owns the
 * chrome and the geometry every screen shares. Nothing here decides what the
 * app may show — sections, counts and banners arrive already resolved, so
 * this stays a rendering surface that the shell can be tested without.
 */

/** Tells the monitor whether the board is open (opening it counts as seeing). */
function ViewingTracker({ viewing }: { viewing: boolean }) {
  const { setViewingBoard } = useOrderMonitor();
  useEffect(() => {
    setViewingBoard(viewing);
  }, [viewing, setViewingBoard]);
  return null;
}

/** New-order toasts above the tab bar; tapping opens the Orders tab. */
function MonitorToastStack({ onOpen }: { onOpen: () => void }) {
  const { toasts, dismissToast } = useOrderMonitor();
  return <MonitorToasts toasts={toasts} onOpen={onOpen} onDismiss={dismissToast} />;
}

/**
 * The phone tab bar's glyphs come from the shared icon set, never emoji. The
 * bar only ever carries the sections marked `phone: "bar"`; the other ids are
 * unreachable here and draw nothing.
 */
function PhoneTabIcon({ id }: { id: AppSectionId }) {
  switch (id) {
    case "capture":
      return <CameraIcon size={22} />;
    case "library":
      return <BookIcon size={22} />;
    case "orders":
      return <ReceiptIcon size={22} />;
    default:
      return null;
  }
}

export interface ShellFrameProps {
  /** The confirm dialog (`useConfirm().dialog`), above everything else. */
  dialog: ReactNode;
  /**
   * The full-screen session loader (`session-loader.tsx`), when the shell is
   * still waiting on the account. It covers the frame rather than replacing
   * it: the reads that end the wait belong to the providers above, so the
   * frame keeps running underneath. The frame never decides whether it shows
   * — `sessionLoaderCovers` does — so this stays chrome. It is rendered
   * outside the frame, and the frame goes `inert` while that node is actually
   * covering it.
   */
  sessionLoader?: ReactNode;
  /** Which surface is showing: the sidebar's current entry, the phone nav. */
  screen: AppScreen;
  /** The editor's working measure, wider than the content screens'. */
  wideMeasure: boolean;
  /**
   * The open editor's save state, shown in the phone brand row. Below `sm`
   * there is no room for it on the editor's tab strip, and the top row's
   * right-hand side is empty. The frame never reads it, so it stays chrome.
   */
  saveStatus?: ReactNode;
  /**
   * The screen column: the shell's banners, then the screen itself. The frame
   * never inspects it, so a page can grow notices without touching this.
   */
  children: ReactNode;

  signedIn: boolean;
  sessionPending: boolean;
  email: string | null;
  /** The order monitor's identity: the account and the café on shift. */
  userId: string | null;
  restaurantId: string | null;
  /** The monitor's own reads have not settled yet. */
  monitorPending: boolean;

  /** The left column belongs to the account (see `shellColumnVisible`). */
  showColumn: boolean;
  sidebar: {
    sections: AppSection[];
    /** The destination list has an answer (session and membership settled). */
    ready: boolean;
    launch: { done: number; total: number } | null;
    menusPending: boolean;
  };

  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  onSwitchWorkspace: (key: string) => void;

  phone: {
    /** No phone nav before the destinations are known (no provisional bar). */
    ready: boolean;
    tabs: PhoneTab[];
    moreRows: MoreSheetRow[];
    moreOpen: boolean;
    onToggleMore: () => void;
    onCloseMore: () => void;
    /** The current screen lives in the More sheet (so it shows as pressed). */
    screenInMore: boolean;
    /** The launch checklist is this member's to see. */
    canGetStarted: boolean;
    /** The More sheet's checklist line: progress, finished, or not read yet. */
    launchHint: string;
  };

  onNavigate: (section: AppSectionId) => void;
  onHome: () => void;
  onSignIn?: () => void;
  onSignOut: () => void;
  onOpenOrders: () => void;
}

export function ShellFrame({
  dialog,
  sessionLoader,
  screen,
  wideMeasure,
  saveStatus,
  children,
  signedIn,
  sessionPending,
  email,
  userId,
  restaurantId,
  monitorPending,
  showColumn,
  sidebar,
  workspaces,
  activeWorkspace,
  onSwitchWorkspace,
  phone,
  onNavigate,
  onHome,
  onSignIn,
  onSignOut,
  onOpenOrders,
}: ShellFrameProps) {
  const sessionHint = useSessionHint();
  /**
   * Whether the loader is genuinely covering the frame. CSS shows it from the
   * boot script's `data-session` on <html>, and that attribute is only its copy
   * of the hint cookie — so the cookie is what decides whether the frame under
   * it can be reached. The node's mere presence would also inert a visitor's
   * frame, whose element is mounted but hidden, and the hint stays `unknown`
   * (no inert) until the browser can read its jar.
   */
  const covered = sessionLoader != null && sessionHint === "hinted";

  return (
    <OrderMonitorProvider userId={userId} restaurantId={restaurantId} pending={monitorPending}>
      {/* `inert`, not removed: the reads that end the wait live above the
        frame, so the shell keeps running — it just cannot be tabbed into or
        read out while the wait covers it. */}
      <div className="flex min-h-full flex-1 flex-col" inert={covered}>
        {dialog}
        <ViewingTracker viewing={signedIn && screen === "orders"} />
        {/* Default stretch: the content column fills the row, so its flex-1 main
          absorbs the spare height and the footer rests on the viewport bottom
          instead of floating under short content. */}
        <div className="flex w-full flex-1">
          {showColumn ? (
            <AppSidebar
              sections={sidebar.sections}
              activeSection={sectionForScreen(screen)}
              sessionPending={sessionPending}
              sectionsPending={!sidebar.ready}
              signedIn={signedIn}
              email={email}
              onNavigate={onNavigate}
              onSignOut={onSignOut}
              onSignIn={onSignIn}
              onHome={onHome}
              launch={sidebar.launch}
              menusPending={sidebar.menusPending}
            />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Wherever the column is absent the row carries the brand, and
              signed out it carries the only sign-in path. It hides itself
              below `sm` only when the sidebar is already showing the lockup;
              nothing here is sticky, so no screen loses height twice. */}
            <BrandBar
              signedIn={signedIn}
              sessionPending={sessionPending}
              className={showColumn ? "sm:hidden" : undefined}
              // The editor's save state takes the row's empty right-hand side
              // on a phone; `sm:hidden` keeps it from ever doubling the copy
              // the tab strip shows from `sm` up.
              trailing={saveStatus ? <div className="sm:hidden">{saveStatus}</div> : undefined}
              onHome={onHome}
              // Every in-shell sign-in goes through the choice first: attach
              // the browser draft on login or wipe it on login.
              onSignIn={onSignIn}
            />
            {/* The sidebar names the account, not the café on shift: a second
              membership keeps its "Acting as" strip, which sits above the
              content now that the old header row is gone. */}
            <WorkspaceSwitcher
              workspaces={workspaces}
              active={activeWorkspace}
              onSwitch={onSwitchWorkspace}
            />
            <main
              className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 pt-2 pb-8 sm:px-6 sm:py-8 ${
                // The editor is a dense working surface; the other app screens
                // — including the publish step, which is onboarding rather
                // than editing — share the brand row's measure so the page
                // and the lockup start on the same left edge.
                wideMeasure ? "max-w-6xl" : "max-w-5xl"
              }`}
            >
              {children}
            </main>
            <SiteFooter />
          </div>
        </div>
        {/*
        Phone nav: signed in, the tab bar pins Capture · My menus · Orders ·
        More (Orders keeps its home for the R0.3 monitor badge; the rest
        lives in the More sheet). Signed out there is no tab bar at all: the
        only screen is Capture, and a draft left behind is resumed from its
        banner — no Orders, no More, no My menus. Sits after the footer so it
        is the last thing on the page and sticks to the viewport bottom
        instead of floating above the footer links.
      */}
        {phone.ready && signedIn ? (
          <nav
            data-print-hide
            aria-label="Sections"
            className="sticky bottom-0 z-30 border-t border-line-200 bg-surface-base/95 backdrop-blur-sm sm:hidden"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex px-2 pt-1">
              {phone.tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    phone.onCloseMore();
                    onNavigate(tab.id);
                  }}
                  aria-current={screen === tab.id ? "page" : undefined}
                  className={`relative flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 ${
                    screen === tab.id ? "text-accent-700" : "text-ink-500"
                  }`}
                >
                  {tab.id === "orders" && <NewOrdersBadge tone="bar" />}
                  <span aria-hidden="true" className="flex h-[22px] items-center">
                    <PhoneTabIcon id={tab.id} />
                  </span>
                  {tab.label}
                </button>
              ))}
              {signedIn && (phone.moreRows.length > 0 || phone.canGetStarted) && (
                <button
                  type="button"
                  onClick={phone.onToggleMore}
                  aria-expanded={phone.moreOpen}
                  aria-current={phone.screenInMore ? "page" : undefined}
                  className={`flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 ${
                    phone.moreOpen || phone.screenInMore ? "text-accent-700" : "text-ink-500"
                  }`}
                >
                  <span aria-hidden="true" className="flex h-[22px] items-center">
                    <MoreIcon size={22} />
                  </span>
                  More
                </button>
              )}
            </div>
          </nav>
        ) : null}
        {signedIn && phone.moreOpen && (
          <div className="sm:hidden">
            <div
              aria-hidden="true"
              onClick={phone.onCloseMore}
              className="fixed inset-0 z-40 bg-scrim"
            />
            <div
              role="dialog"
              aria-label="More"
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border border-line-200 bg-surface-base px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            >
              <div
                aria-hidden="true"
                className="mx-auto mb-1 h-1.5 w-11 rounded-full bg-surface-200"
              />
              {phone.moreRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    phone.onCloseMore();
                    onNavigate(row.id);
                  }}
                  className="flex min-h-[52px] w-full flex-col justify-center rounded-xl px-2 text-left transition-colors hover:bg-surface-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  <span className="text-sm font-semibold text-ink-900">{row.label}</span>
                  <span className="text-xs font-normal text-ink-500">{row.why}</span>
                </button>
              ))}
              {/* The checklist is progress, not another destination: its own
                card above the rule, with the count the sidebar shows. It
                stays an owner's surface (`settings.manage`), like the Get
                started link it replaces. */}
              {phone.canGetStarted && (
                <a
                  href="/launch"
                  className="mt-2 flex min-h-[56px] items-center gap-3 rounded-xl border border-line-200 bg-surface-50 px-3 py-2.5 transition-colors hover:bg-surface-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-base text-ink-600"
                  >
                    <ChecklistIcon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink-900">
                      Launch checklist
                    </span>
                    <span className="block text-xs font-normal text-ink-500">
                      {phone.launchHint}
                    </span>
                  </span>
                  {sidebar.launch ? (
                    <span
                      aria-hidden="true"
                      className="shrink-0 rounded-full bg-surface-base px-2 py-0.5 text-[11px] font-semibold text-ink-600"
                    >
                      {sidebar.launch.done}/{sidebar.launch.total}
                    </span>
                  ) : null}
                  {sidebar.launch ? (
                    <span className="sr-only">
                      {sidebar.launch.done} of {sidebar.launch.total} steps done
                    </span>
                  ) : null}
                </a>
              )}
              {/* The app has no top bar on a phone, so the account lives here:
                one place to see who is signed in and to end the session. It
                is the last thing in the sheet, under the destinations. */}
              <div className="mt-2 border-t border-line-200 pt-1">
                <p className="truncate px-2 pt-1 text-[11px] text-ink-500">{email}</p>
                <button
                  type="button"
                  onClick={() => {
                    phone.onCloseMore();
                    onSignOut();
                  }}
                  className="flex min-h-[44px] w-full items-center rounded-xl px-2 text-left text-sm font-medium text-ink-700 transition-colors hover:bg-surface-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}
        <MonitorToastStack onOpen={onOpenOrders} />
      </div>
      {/* A sibling of the frame it covers: `inert` must never reach the loader
        itself. */}
      {sessionLoader}
    </OrderMonitorProvider>
  );
}
