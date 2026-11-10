"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ProposalReview } from "@/components/assistant/proposal-review";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AssistantApplyError,
  AssistantError,
  applyAssistantProposal,
  fetchAssistantStatus,
  sendAssistantMessage,
} from "@/features/assistant/client";
import { setProposalOperationPrice, type AssistantProposal } from "@/features/assistant/proposal";
import {
  ASSISTANT_MAX_MESSAGE_CHARS,
  type AssistantHistoryMessage,
  type AssistantUsageSummary,
} from "@/features/assistant/schema";

/**
 * Assistant tab (A1 help + A3 review).
 *
 * The panel is still a chat, but an owner can point it at one of their
 * account menus. The model then returns a proposal, which is shown as the
 * server-computed diff; nothing is written until "Approve and save" calls the
 * approval endpoint with that exact revision. Staff-only menus are filtered
 * out by the shell, and signed-out visitors never see the picker.
 *
 * `proposalsEnabled` is the server's `assistantProposals` release decision:
 * when it is off the panel stays a help chat, with no menu picker and no
 * approval path. The server enforces the same flag, so hiding the UI is not
 * the only protection.
 *
 * History lives in component state (bounded, never persisted); reloading
 * clears the conversation. A proposal belongs to one menu and one revision,
 * so changing the target discards it rather than carrying it across.
 */

export interface AssistantMenuOption {
  id: string;
  title: string;
}

interface AssistantPanelProps {
  signedIn: boolean;
  /** Session still resolving: show a loading shape, never the sign-in card. */
  sessionPending?: boolean;
  /** Account menus the caller owns; staff-only menus are excluded upstream. */
  menus?: readonly AssistantMenuOption[];
  /** The library/account merge is still loading. */
  menusLoading?: boolean;
  /** A3 review is released per account via the `assistantProposals` flag. */
  proposalsEnabled?: boolean;
}

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface AppliedChange {
  menuId: string;
  title: string;
  updatedAt: string;
}

const QUICK_PROMPTS = [
  "How do I publish my menu?",
  "Where do I set opening hours?",
  "How do table QR codes work?",
] as const;

let turnCounter = 0;
function nextTurnId(): string {
  turnCounter += 1;
  return `turn-${turnCounter}`;
}

function formatReset(iso: string | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AssistantPanel({
  signedIn,
  sessionPending = false,
  menus = [],
  menusLoading = false,
  proposalsEnabled = false,
}: AssistantPanelProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<AssistantUsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  /** False when this deployment is missing its Workers AI keys (A4 fallback). */
  const [configured, setConfigured] = useState(true);
  const [selectedMenuId, setSelectedMenuId] = useState("");
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  /** Bumped for each new proposal so price inputs start from the new values. */
  const [proposalKey, setProposalKey] = useState(0);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalStale, setProposalStale] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [applied, setApplied] = useState<AppliedChange | null>(null);
  const [lastRequest, setLastRequest] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A proposal target only exists when the proposal feature is on; keeping
  // this null is what makes every piece of proposal UI disappear together.
  const selectedMenu = proposalsEnabled
    ? (menus.find((menu) => menu.id === selectedMenuId) ?? null)
    : null;
  /** Chosen id vanished from the account (deleted or moved) while the tab was open. */
  const menuUnavailable = proposalsEnabled && selectedMenuId !== "" && selectedMenu === null;
  /** The review is hidden immediately when proposals are switched off. */
  const proposalVisible = proposalsEnabled && proposal !== null;

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchAssistantStatus();
        if (!cancelled) {
          setUsage(status.usage);
          setConfigured(status.configured);
        }
      } catch (loadError) {
        if (!cancelled) {
          setUsageError(
            loadError instanceof AssistantError
              ? loadError.message
              : "Could not load the assistant allowance."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [turns, sending, proposal]);

  const exhausted = usage !== null && usage.remaining <= 0;
  const disabled = !signedIn || sending || proposalBusy || exhausted || !configured;

  const ask = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || sending || proposalBusy || !signedIn || !configured) return;
      if (usage !== null && usage.remaining <= 0) return;
      if (
        proposalVisible &&
        !(await confirm({
          message:
            "Send this? The proposed change on screen has not been saved and will be discarded.",
          confirmLabel: "Send",
        }))
      ) {
        return;
      }

      const history: AssistantHistoryMessage[] = turns.slice(-6).map((turn) => ({
        role: turn.role,
        content: turn.content,
      }));
      const menuId = proposalsEnabled ? selectedMenu?.id : undefined;

      setSending(true);
      setError(null);
      setDraft("");
      setLastRequest(message);
      const userTurn: ChatTurn = { id: nextTurnId(), role: "user", content: message };
      setTurns((current) => [...current, userTurn]);

      try {
        const reply = await sendAssistantMessage({
          message,
          history,
          ...(menuId ? { menuId } : {}),
        });
        setTurns((current) => [
          ...current,
          { id: nextTurnId(), role: "assistant", content: reply.reply },
        ]);
        setUsage(reply.usage);
        setUsageError(null);
        if (reply.proposal) {
          setProposal(reply.proposal);
          setProposalKey((value) => value + 1);
          setProposalStale(false);
          setProposalError(null);
          setApplied(null);
        }
      } catch (sendError) {
        // The optimistic turn is removed so the conversation never shows a
        // question the server did not answer; the draft is restored for retry.
        setTurns((current) => current.filter((turn) => turn.id !== userTurn.id));
        setDraft(message);
        if (sendError instanceof AssistantError) {
          if (sendError.code === "not_configured") setConfigured(false);
          setError(sendError.message);
        } else {
          setError("The assistant is unavailable right now. Try again in a moment.");
        }
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [
      sending,
      signedIn,
      turns,
      usage,
      configured,
      selectedMenu,
      proposalBusy,
      proposalVisible,
      proposalsEnabled,
      confirm,
    ]
  );

  const approve = useCallback(async () => {
    if (!proposal || !proposalVisible || proposalBusy) return;
    const current = proposal;
    if (!menus.some((menu) => menu.id === current.menuId)) {
      setProposalError("This menu is no longer available. Discard this proposal.");
      return;
    }
    setProposalBusy(true);
    setProposalError(null);
    setProposalStale(false);
    try {
      const result = await applyAssistantProposal({
        menuId: current.menuId,
        expectedUpdatedAt: current.basedOnUpdatedAt,
        operations: current.operations,
      });
      const title = menus.find((menu) => menu.id === current.menuId)?.title ?? result.menu.title;
      setApplied({ menuId: current.menuId, title, updatedAt: result.menu.updatedAt });
      setProposal(null);
      setProposalStale(false);
      setError(null);
      inputRef.current?.focus();
    } catch (applyError) {
      if (applyError instanceof AssistantApplyError) {
        if (applyError.code === "stale") {
          setProposalStale(true);
        } else {
          setProposalError(applyError.message);
        }
      } else {
        setProposalError("Could not save the change. Try again in a moment.");
      }
    } finally {
      setProposalBusy(false);
    }
  }, [proposal, proposalVisible, proposalBusy, menus]);

  function discardProposal() {
    setProposal(null);
    setProposalStale(false);
    setProposalError(null);
    inputRef.current?.focus();
  }

  function reviewAgain() {
    setProposal(null);
    setProposalStale(false);
    setProposalError(null);
    setDraft(lastRequest);
    inputRef.current?.focus();
  }

  async function chooseMenu(nextId: string) {
    if (!proposalsEnabled || nextId === selectedMenuId) return;
    if (
      proposal &&
      !(await confirm({
        message: "Discard the proposed change? It has not been saved.",
        confirmLabel: "Discard",
        destructive: true,
      }))
    ) {
      return;
    }
    setSelectedMenuId(nextId);
    setProposal(null);
    setProposalStale(false);
    setProposalError(null);
    setApplied(null);
  }

  if (sessionPending) {
    return (
      <div className="rounded-2xl border border-line-200 bg-surface-base p-6" role="status">
        <span className="sr-only">Loading the assistant…</span>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-4 h-24 w-full" />
        <Skeleton className="mt-3 h-10 w-32" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="rounded-2xl border border-dashed border-line-200 bg-surface-base p-8 text-center">
        <p className="font-medium text-ink-900">Sign in to use the assistant</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-600">
          The assistant answers questions about Eateryo using your own restaurant and menu names. It
          needs an account so answers stay scoped to your data and the cost stays capped.
        </p>
        <a
          href="/sign-in"
          className="mt-4 inline-block rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          Sign in
        </a>
      </div>
    );
  }

  const resetLabel = formatReset(usage?.periodEnd);
  const progressLabel =
    proposalsEnabled && selectedMenu
      ? "Reading your menu — this can take a few seconds…"
      : "Thinking…";

  return (
    <section className="flex flex-col gap-4" aria-labelledby="assistant-heading">
      {dialog}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 id="assistant-heading" className="text-xl font-semibold text-ink-900">
            Assistant
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            {proposalsEnabled && selectedMenu ? (
              <>
                Ask about Eateryo or request a change to{" "}
                <span className="font-medium">{selectedMenu.title}</span>. You review every change
                before it is saved.
              </>
            ) : proposalsEnabled ? (
              "Answers come from Eateryo’s own feature list. Pick one of your menus to ask for an edit."
            ) : (
              "Answers come from Eateryo’s own feature list. Menu changes are not enabled for this account yet."
            )}
          </p>
        </div>
        {usage && (
          <p className="text-xs text-ink-500">
            {usage.remaining} of {usage.cap} messages left
            {resetLabel ? ` · resets ${resetLabel}` : ""}
          </p>
        )}
      </div>

      {proposalsEnabled ? (
        <div className="rounded-2xl border border-line-200 bg-surface-base p-4">
          <label htmlFor="assistant-menu" className="text-xs font-semibold text-ink-600">
            Menu to edit <span className="font-normal text-ink-500">(optional)</span>
          </label>
          <select
            id="assistant-menu"
            value={selectedMenuId}
            onChange={(event) => chooseMenu(event.target.value)}
            disabled={sending || proposalBusy || menusLoading}
            className="mt-1 w-full rounded-xl border border-line-300 bg-surface-base px-3 py-2 text-sm text-ink-900 focus:border-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 disabled:cursor-not-allowed disabled:bg-surface-100"
          >
            <option value="">Help only — no menu changes</option>
            {menuUnavailable && <option value={selectedMenuId}>Unavailable menu</option>}
            {menus.map((menu) => (
              <option key={menu.id} value={menu.id}>
                {menu.title}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs leading-5 text-ink-500">
            {menusLoading
              ? "Loading your account menus…"
              : menuUnavailable
                ? "That menu is no longer in your account. Choose another one."
                : menus.length === 0
                  ? "No account menus yet. Add a menu to your account to ask the assistant for edits."
                  : selectedMenu
                    ? "Changes are proposed for review. Nothing is saved until you approve."
                    : "Pick one of your menus to request a change; leave it on help for how-to questions."}
          </p>
        </div>
      ) : (
        <p className="rounded-xl border border-line-200 bg-surface-50 px-4 py-3 text-xs leading-5 text-ink-600">
          Menu changes are being tested with selected accounts. You can still ask how-to questions
          here.
        </p>
      )}

      {usageError && (
        <p className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-900">
          {usageError}
        </p>
      )}

      {exhausted && (
        <p
          role="alert"
          className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-900"
        >
          This account has used all {usage?.cap} assistant messages for this month.
          {resetLabel ? ` The allowance resets on ${resetLabel}.` : ""}
        </p>
      )}

      {!configured && (
        <p
          role="alert"
          className="rounded-xl border border-line-200 bg-surface-100 px-4 py-3 text-sm text-ink-800"
        >
          The assistant isn’t configured on this deployment yet. Ask an operator to finish the
          Workers AI setup; the rest of Eateryo works as usual.
        </p>
      )}

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Assistant conversation"
        className="flex max-h-[28rem] min-h-48 flex-col gap-3 overflow-y-auto rounded-2xl border border-line-200 bg-surface-base p-4"
      >
        {turns.length === 0 && !sending ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-ink-600">
              {proposalsEnabled && selectedMenu
                ? "Ask for a change — for example “add a lemonade for 3.50”. The assistant will ask which category if it is unclear, and you will see the exact diff before approving."
                : "Ask how to do something in Eateryo — publishing, table QR codes, opening hours, team access."}
            </p>
            {!selectedMenu && (
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void ask(prompt)}
                    className="rounded-full bg-surface-100 px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-surface-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          turns.map((turn) => (
            <article
              key={turn.id}
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-6 ${
                turn.role === "user"
                  ? "self-end bg-surface-900 text-on-accent"
                  : "self-start bg-surface-100 text-ink-800"
              }`}
            >
              <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide opacity-60">
                {turn.role === "user" ? "You" : "Assistant"}
              </p>
              <p className="whitespace-pre-wrap">{turn.content}</p>
            </article>
          ))
        )}
        {sending && (
          <p
            role="status"
            className="self-start rounded-2xl bg-surface-100 px-4 py-2.5 text-sm text-ink-600"
          >
            {progressLabel}
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800"
        >
          {error}
        </p>
      )}

      {applied && (
        <div
          role="status"
          className="rounded-2xl border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-900"
        >
          <p className="font-medium">Change saved to “{applied.title}”.</p>
          <p className="mt-1 text-xs leading-5 text-success-800">
            The draft is updated. Diners keep seeing the published version until you publish
            changes.
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium">
            <a
              href={`/menus/${encodeURIComponent(applied.menuId)}`}
              className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success-800"
            >
              Open in editor
            </a>
            <button
              type="button"
              onClick={() => setApplied(null)}
              className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {proposal && proposalVisible && (
        <ProposalReview
          key={proposalKey}
          proposal={proposal}
          menuTitle={menus.find((menu) => menu.id === proposal.menuId)?.title ?? "your menu"}
          editorHref={`/menus/${encodeURIComponent(proposal.menuId)}`}
          busy={proposalBusy}
          stale={proposalStale}
          error={proposalError}
          onPriceChange={(index, price) =>
            setProposal((current) =>
              current ? setProposalOperationPrice(current, index, price) : current
            )
          }
          onApprove={() => void approve()}
          onDiscard={discardProposal}
          onReviewAgain={reviewAgain}
        />
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="assistant-message" className="sr-only">
          Ask the assistant
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="assistant-message"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, ASSISTANT_MAX_MESSAGE_CHARS))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(draft);
              }
            }}
            rows={2}
            maxLength={ASSISTANT_MAX_MESSAGE_CHARS}
            disabled={disabled}
            enterKeyHint="send"
            placeholder={
              !configured
                ? "Assistant not configured"
                : exhausted
                  ? "Monthly allowance reached"
                  : proposalsEnabled && selectedMenu
                    ? `Ask for a change to ${selectedMenu.title}…`
                    : "Ask a question…"
            }
            className="min-h-14 flex-1 resize-none rounded-xl border border-line-300 bg-surface-base px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 disabled:cursor-not-allowed disabled:bg-surface-100 sm:resize-y"
          />
          <button
            type="submit"
            disabled={disabled || draft.trim().length === 0}
            className="rounded-full bg-accent-700 px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 disabled:cursor-not-allowed disabled:bg-surface-300"
          >
            {sending ? "Sending…" : proposalBusy ? "Saving…" : "Send"}
          </button>
        </div>
        <p className="text-xs text-ink-500">
          Enter sends · Shift + Enter adds a line · {draft.length}/{ASSISTANT_MAX_MESSAGE_CHARS}
        </p>
      </form>
    </section>
  );
}
