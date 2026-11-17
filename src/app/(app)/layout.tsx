import { Suspense, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { LibraryProvider } from "@/features/menus/library-context";
import { NavigationProvider } from "@/features/navigation/navigation-context";
import { WorkspaceProvider } from "@/features/tenancy/workspace-context";

/**
 * Every app screen sits in this one layout, so the units that outlive a screen
 * are mounted once: the session and its cafés, the route, and the library — in
 * dependency order, each reading the one above it. A screen change never
 * unmounts the facts they hold.
 *
 * The boundary is load-bearing, not decoration. The route is read from the URL
 * (see `NavigationProvider`), and a menu URL's id is not known when the layout
 * is prerendered, so the shell streams its fallback for those; `cacheComponents`
 * requires a boundary around a client hook that reads a URL segment it cannot
 * resolve at build time. Static screens never suspend, so they still
 * server-render their shell.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellLoading />}>
      <WorkspaceProvider>
        <NavigationProvider>
          <LibraryProvider>{children}</LibraryProvider>
        </NavigationProvider>
      </WorkspaceProvider>
    </Suspense>
  );
}

/**
 * The shell's own geometry — a column plus the content measure — so a streamed
 * screen does not shift the page when it arrives, and the column keeps
 * `app-sidebar` so its width follows the saved rail/expanded choice.
 */
function ShellLoading() {
  return (
    <div className="flex w-full flex-1">
      <aside
        aria-hidden="true"
        className="app-sidebar hidden h-screen shrink-0 self-start border-r border-line-200 bg-surface-base sm:block"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
          <div role="status" aria-busy="true" className="flex flex-col gap-4">
            <span className="sr-only">Opening menu…</span>
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-28 rounded-full" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
                <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                </div>
                <Skeleton className="mt-3 h-28" />
              </div>
              <div className="rounded-2xl border border-line-200 bg-surface-base p-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-2 h-3 w-3/5" />
                <Skeleton className="mt-4 h-9" />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
