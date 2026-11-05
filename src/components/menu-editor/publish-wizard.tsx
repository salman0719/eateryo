"use client";

import { useEffect, useMemo, useState } from "react";

import { MagicLinkForm } from "@/components/auth/magic-link-form";
import { OrderPagePreview } from "@/components/order/order-page-preview";
import { JourneySteps } from "@/components/ui/journey-steps";
import { Skeleton } from "@/components/ui/skeleton";
import { PhoneFrame } from "@/components/ui/phone-frame";
import type { MenuDocument } from "@/features/menu/schema";
import { SyncError } from "@/features/menus/sync";
import { PUBLISH_STEP_INDEX } from "@/features/onboarding/journey";
import { fetchPublication } from "@/features/publishing/client";
import type { PublicationStatus } from "@/features/publishing/schema";
import { publishMenuWithSetup } from "@/features/publishing/setup-client";
import type { PublishSetupResult } from "@/features/publishing/setup-schema";
import {
  clearWizardLinkSent,
  clearWizardState,
  defaultWizardState,
  forgetPublishJourney,
  hasPublishJourney,
  loadWizardLinkSent,
  loadWizardState,
  publishWizardPath,
  resolveWizardRestaurant,
  saveWizardLinkSent,
  saveWizardState,
  type PublishWizardState,
} from "@/features/publishing/wizard-state";
import type { RestaurantOption } from "@/features/tenancy/client";

import { AvailabilityPanel } from "./availability-panel";

function errorCopy(error: unknown): string {
  if (error instanceof SyncError) {
    switch (error.code) {
      case "unauthorized":
        return "Your sign-in expired. Sign in again — your draft is still in this browser.";
      case "forbidden":
        return "Only the owner of this restaurant can publish its menus.";
      case "not_found":
        return "This menu is no longer in your account. Reopen it from My menus and try again.";
      case "invalid":
        return error.message;
      case "slug_taken":
        return "That address is already used by another menu at this café. Try publishing again.";
      default:
        return "Could not reach the server. Your draft is safe in this browser — try again.";
    }
  }
  return "Something went wrong. Your draft is safe in this browser.";
}

function WizardSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Preparing your tables…</span>
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-3 h-9 w-full" />
          <Skeleton className="mt-2 h-9 w-full" />
          <Skeleton className="mt-4 h-10 w-40 rounded-full" />
        </div>
        <Skeleton className="h-[420px] rounded-[2.4rem]" />
      </div>
    </div>
  );
}

interface PublishWizardProps {
  doc: MenuDocument;
  signedIn: boolean;
  sessionPending: boolean;
  /** The signed-in account's id; null while signed out. */
  accountKey: string | null;
  /** Restaurants the caller owns; staff-only restaurants never appear here. */
  ownedRestaurants: RestaurantOption[];
  /** True until the owned-restaurant lookup settles. */
  restaurantsLoading: boolean;
  /** The shell updates its account/menu state from this result. */
  onPublished: (result: PublishSetupResult) => void;
  onBack: () => void;
  onOpenTables: () => void;
  onOpenEditor: () => void;
}

/**
 * The publish stop — the fourth step of onboarding, and the R1 publish wizard.
 *
 * Reached from the review screen, it continues the one four-stop journey
 * (Upload · Extract · Review · Publish) rather than starting a second one; a
 * menu opened straight from My menus has no journey marker, so it gets a
 * plain heading instead of a tracker it did not just walk.
 *
 * The draft is already saved in IndexedDB, so signing in is a gate inside this
 * stop, not a way out of it: the emailed link returns to this exact URL and
 * the short form is restored from localStorage. One submit then creates the
 * restaurant only when the owner has none, attaches the menu and publishes
 * the snapshot.
 *
 * The success screen sells the right payoff: the menu is orderable at the
 * tables, reached through printed table cards. There is no menu page and no
 * link, so none is offered.
 */
export function PublishWizard({
  doc,
  signedIn,
  sessionPending,
  accountKey,
  ownedRestaurants,
  restaurantsLoading,
  onPublished,
  onBack,
  onOpenTables,
  onOpenEditor,
}: PublishWizardProps) {
  const fallback = useMemo(() => defaultWizardState(doc), [doc]);
  const [form, setForm] = useState<PublishWizardState>(() => loadWizardState(doc.id, fallback));
  /** Opened from the review screen, so the four-stop journey continues here. */
  const [continuesJourney] = useState(() => hasPublishJourney(doc.id));
  // A link requested earlier restores its panel after reloads and returns.
  const initialLinkSent = useMemo(() => loadWizardLinkSent(doc.id), [doc.id]);
  const publicationKey = `${accountKey ?? "anonymous"}:${doc.id}`;
  /** Which account+menu the publication state belongs to. */
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [published, setPublished] = useState<PublicationStatus | null>(null);
  const [submitResult, setSubmitResult] = useState<PublishSetupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHours, setShowHours] = useState(false);
  /** The café name is confirmed by default; "Change" reveals the field. */
  const [nameEditing, setNameEditing] = useState(false);

  useEffect(() => {
    saveWizardState(doc.id, form);
  }, [doc.id, form]);

  // A signed-in owner has no pending link: forget the stored request so a
  // later sign-out never resurrects a dead "check your email" panel.
  // Storage only, no state — nothing here can loop or flash.
  useEffect(() => {
    if (signedIn) clearWizardLinkSent(doc.id);
  }, [signedIn, doc.id]);

  // A reload after publishing (or opening a menu that is already live) must
  // show the success screen rather than a fresh publish form. `checkedFor`
  // tracks the answer per account+menu, so a stale success never renders
  // while another account's publication is still being read.
  useEffect(() => {
    if (!signedIn || !accountKey) return;
    let cancelled = false;
    void fetchPublication(doc.id)
      .then((status) => {
        if (cancelled) return;
        setPublished(status?.isLive ? status : null);
        setCheckedFor(publicationKey);
      })
      .catch(() => {
        // A 404 is normal for a browser-only draft; the form still works.
        if (!cancelled) {
          setPublished(null);
          setCheckedFor(publicationKey);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, doc.id, publicationKey, signedIn]);

  const choice = resolveWizardRestaurant(form, ownedRestaurants);
  /** A café we can name confidently: the field stays hidden until asked. */
  const confirmedName = choice.kind === "create" ? choice.name : "";
  const nameFieldVisible = nameEditing || confirmedName === "";
  const checking = signedIn && checkedFor !== publicationKey;
  const canSubmit =
    signedIn &&
    !sessionPending &&
    !restaurantsLoading &&
    !checking &&
    !busy &&
    (choice.kind === "existing" || choice.kind === "create");

  function update(patch: Partial<PublishWizardState>) {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
  }

  async function handlePublish() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await publishMenuWithSetup(doc.id, {
        doc,
        ...(choice.kind === "existing"
          ? { restaurantId: choice.id }
          : choice.kind === "create"
            ? { restaurantName: choice.name }
            : {}),
      });
      setPublished(result.publication);
      setSubmitResult(result);
      clearWizardState(doc.id);
      forgetPublishJourney(doc.id);
      onPublished(result);
    } catch (publishError) {
      setError(errorCopy(publishError));
    } finally {
      setBusy(false);
    }
  }

  if (sessionPending || (signedIn && checking)) return <WizardSkeleton />;

  if (signedIn && published?.isLive) {
    const restaurantName =
      submitResult?.restaurant.name ??
      ownedRestaurants.find((restaurant) => restaurant.id === published.restaurantId)?.name ??
      null;

    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wide text-warning-800 uppercase">
              {submitResult?.created.menu ? "First menu published" : "Published for ordering"}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
              Your menu is live for your tables
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-600">
              {submitResult?.created.restaurant
                ? `We created “${submitResult.restaurant.name}” for you — rename it in Settings whenever you like. `
                : ""}
              Diners scan a table card and order from this menu; orders land on your board. There
              is no public menu page, so there is no link to share.
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-line-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            ← Back to editing
          </button>
        </div>

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line-200 bg-surface-base p-5">
            <div className="rounded-xl border border-line-200 bg-surface-50 p-4">
              <h2 className="text-sm font-semibold text-ink-900">Next: print a table card</h2>
              <p className="mt-1 text-xs leading-5 text-ink-600">
                One QR per table — each card orders for its table across every open menu. They
                print from the Tables tab.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onOpenTables}
                  className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  Add tables &amp; print QR codes
                </button>
                <button
                  type="button"
                  onClick={() => setShowHours((value) => !value)}
                  aria-expanded={showHours}
                  className="rounded-full border border-line-300 bg-surface-base px-4 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  {showHours ? "Hide opening hours" : "Set your opening hours"}
                </button>
                <button
                  type="button"
                  onClick={onOpenEditor}
                  className="rounded-full border border-line-300 bg-surface-base px-4 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  Keep editing
                </button>
              </div>
              {showHours && (
                <div className="mt-3">
                  <AvailabilityPanel menuId={doc.id} syncMode="account" />
                </div>
              )}
            </div>

            <p className="text-xs leading-5 text-ink-500">
              Edits made in the editor stay off your tables until you press “Publish changes” —
              diners always see the last published version.
            </p>
          </section>

          <aside className="flex flex-col gap-2">
            <PhoneFrame label="Diner page at a table">
              <OrderPagePreview doc={doc} restaurantName={restaurantName} />
            </PhoneFrame>
            <p className="text-center text-xs text-ink-500">
              Ordering is off in this preview; a real table card turns it on.
            </p>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-warning-800 uppercase">
            Publish your menu
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
            {signedIn ? "One short form, then you can take orders" : "Sign in to publish your menu"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-600">
            {signedIn
              ? "We will create your café only if you don’t have one yet, attach this draft, and make it orderable at your tables. Nothing else is required."
              : "Publishing needs an account — it’s the only thing we ask for. Your draft is saved in this browser, so it will be waiting when you come back; the emailed link returns you to this same screen."}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-line-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          ← Back to editing
        </button>
      </div>

      {continuesJourney && <JourneySteps current={PUBLISH_STEP_INDEX} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex flex-col gap-4 rounded-2xl border border-line-200 bg-surface-base p-5">
          {!signedIn ? (
            <>
              <div className="rounded-xl border border-warning-200 bg-warning-50 p-3 text-xs leading-5 text-warning-900">
                The draft stays exactly as you left it. Use the same browser you uploaded from when
                you open the emailed link.
              </div>
              <MagicLinkForm
                callbackURL={publishWizardPath(doc.id)}
                initialSent={initialLinkSent}
                onSent={(sent) => saveWizardLinkSent(doc.id, sent)}
                onSentCleared={() => clearWizardLinkSent(doc.id)}
              />
              <p className="text-xs leading-5 text-ink-500">
                No password, no card — signing in is just how the menu becomes yours.
              </p>
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold text-ink-900">Your café</p>
                {restaurantsLoading ? (
                  <div role="status" aria-busy="true" className="mt-2">
                    <span className="sr-only">Loading your restaurants…</span>
                    <Skeleton className="h-9 w-full" />
                  </div>
                ) : ownedRestaurants.length === 0 ? (
                  nameFieldVisible ? (
                    <label className="mt-2 flex flex-col gap-1 text-xs font-medium text-ink-600">
                      Name your restaurant
                      <input
                        type="text"
                        value={form.restaurantName}
                        onChange={(event) => update({ restaurantName: event.target.value })}
                        placeholder="e.g. Sunny Side Café"
                        className="rounded-lg border border-line-300 px-3 py-2 text-sm text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                      />
                      <span className="text-xs font-normal text-ink-500">
                        You can rename it later in Settings.
                      </span>
                    </label>
                  ) : (
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-surface-50 px-3 py-2">
                      <p className="text-sm text-ink-800">
                        Publishing under <span className="font-medium">{confirmedName}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => setNameEditing(true)}
                        className="rounded-full border border-line-300 bg-surface-base px-2.5 py-0.5 text-xs font-medium text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                      >
                        Change
                      </button>
                    </div>
                  )
                ) : ownedRestaurants.length === 1 && ownedRestaurants[0] ? (
                  <p className="mt-1 rounded-lg bg-surface-50 px-3 py-2 text-sm text-ink-800">
                    Publishing under <span className="font-medium">{ownedRestaurants[0].name}</span>
                  </p>
                ) : (
                  <label className="mt-2 flex flex-col gap-1 text-xs font-medium text-ink-600">
                    Publishing under
                    <select
                      value={form.restaurantId}
                      onChange={(event) => update({ restaurantId: event.target.value })}
                      className="rounded-lg border border-line-300 bg-surface-base px-3 py-2 text-sm text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                    >
                      <option value="" disabled>
                        Choose a restaurant…
                      </option>
                      {ownedRestaurants.map((restaurant) => (
                        <option key={restaurant.id} value={restaurant.id}>
                          {restaurant.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {choice.kind === "choose" && (
                <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs leading-5 text-warning-900">
                  Choose which café this menu belongs to above.
                </p>
              )}
              {choice.kind === "missing" && (
                <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs leading-5 text-warning-900">
                  Give your café a name above so we can create it.
                </p>
              )}

              {error && (
                <p
                  role="alert"
                  className="rounded-xl bg-danger-50 px-3 py-2 text-xs leading-5 text-danger-800"
                >
                  {error}
                </p>
              )}

              <div>
                <button
                  type="button"
                  onClick={() => void handlePublish()}
                  disabled={!canSubmit}
                  className="w-full rounded-full bg-accent-700 px-6 py-3 text-base font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 sm:w-auto"
                >
                  {busy ? "Publishing…" : "Publish my menu"}
                </button>
                <p className="mt-2 text-xs text-ink-500">
                  Free while the promotion lasts. The draft is saved before anything is sent.
                </p>
              </div>
            </>
          )}
        </section>

        <aside className="flex flex-col gap-2">
          <PhoneFrame label="What a table card opens">
            <OrderPagePreview
              doc={doc}
              restaurantName={choice.kind === "existing" || choice.kind === "create" ? choice.name : null}
            />
          </PhoneFrame>
          <p className="text-center text-xs text-ink-500">
            Ordering is off in this preview; a real table card turns it on.
          </p>
        </aside>
      </div>
    </div>
  );
}
