"use client";

import { useEffect, useState } from "react";

import { DataControls } from "@/components/launch/data-controls";
import { CommitInput } from "@/components/menu-editor/fields";
import { OrderAlertsCard } from "@/components/settings/order-alerts";
import { TeamActivity } from "@/components/settings/team-activity";
import { UsagePanel } from "@/components/settings/usage-panel";
import { GuidanceCard } from "@/components/ui/guidance-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addMember,
  createRestaurant,
  deleteRestaurant,
  fetchMembers,
  fetchPendingInvitations,
  removeMember,
  renameRestaurant,
  resendInvitation,
  revokeInvitation,
  updateMemberRole,
  type MemberOption,
  type PendingInvitation,
} from "@/features/tenancy/client";
import { useWorkspace } from "@/features/tenancy/workspace-context";
import { SyncError } from "@/features/menus/sync";
import { useConfirm } from "@/components/ui/confirm-dialog";

/**
 * Restaurant settings: rename inline, manage the team (owner-only writes),
 * and delete behind a danger zone that spells out what cascades. Members
 * can see the team; the writes refuse non-owners server-side too, so the UI
 * never has to guess — it just reports what the API answered.
 *
 * The team panel is keyed by restaurant id, so switching restaurants
 * remounts it with fresh state instead of resetting state in effects.
 */

export function RestaurantSettings() {
  const workspace = useWorkspace();
  const { confirm, dialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after each successful team change so the activity card reloads.
  const [teamVersion, setTeamVersion] = useState(0);

  // The café is the shell's active membership: this page keeps no list and no
  // second picker, so it cannot disagree with the switcher.
  const active = workspace.active;
  const selected = active ? { id: active.restaurantId, name: active.name } : null;
  const restaurants = workspace.restaurants;
  const allRestaurants = restaurants ?? [];
  const loadFailed = workspace.failedFor !== null;
  const signedIn = workspace.signedIn;
  const sessionPending = workspace.sessionPending;
  const currentUserId = workspace.userId;
  const canManageSettings = workspace.can("settings.manage");
  const canManageTeam = workspace.can("team.manage");
  const canReadTeam = workspace.can("team.read");
  /** Capture's permission: the extraction spend below belongs to whoever may upload. */
  const canCapture = workspace.can("menus.write");

  async function handleRename(name: string) {
    if (!selected || !canManageSettings) return;
    setError(null);
    try {
      const updated = await renameRestaurant(selected.id, name);
      workspace.addRestaurant(updated);
    } catch {
      setError("Could not rename the restaurant. Try again.");
    }
  }

  async function handleDeleteRestaurant() {
    if (!selected || deleting) return;
    const ok = await confirm({
      message: `Delete “${selected.name}” permanently? Its menus, published pages and orders are deleted too. This cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteRestaurant(selected.id);
      workspace.removeRestaurant(selected.id);
    } catch {
      setError("Could not delete the restaurant. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-ink-900">Restaurant settings</h2>

      {!signedIn && !sessionPending && (
        <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
          <p className="text-sm font-medium text-ink-900">Sign in to manage your restaurants</p>
          <p className="mt-1 text-xs leading-5 text-ink-500">
            Restaurant names, team members and deletion live in your account.
          </p>
          <a
            href="/sign-in"
            className="mt-3 inline-block rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            Sign in
          </a>
        </div>
      )}

      {signedIn && loadFailed && (
        <p className="text-xs text-danger-700">
          Could not load your restaurants. Check your connection and try again.{" "}
          <button
            type="button"
            onClick={() => workspace.refresh()}
            className="font-semibold text-danger-900 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-900"
          >
            Try again
          </button>
        </p>
      )}

      {(sessionPending || signedIn) && restaurants === null && !loadFailed && (
        <div role="status" aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">Loading your restaurants…</span>
          <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-9 w-full max-w-sm" />
            <Skeleton className="mt-3 h-3 w-2/5" />
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-8 w-28 rounded-full" />
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
          </div>
        </div>
      )}

      {selected && !canManageSettings && (
        <p className="rounded-2xl border border-line-200 bg-surface-base p-5 text-xs leading-5 text-warning-800">
          You can see this café’s team and activity. Changing its name, alerts or team needs the
          owner — ask them to do it from their sign-in.
        </p>
      )}

      <OwnRestaurantCard />

      {signedIn && !loadFailed && restaurants !== null && allRestaurants.length === 0 && (
        <GuidanceCard
          title="You don't own a restaurant yet"
          steps={[
            "Open My menus and pick a menu — upload a photo first if you don't have one yet.",
            "Use “Import from this browser” in My menus: adding a menu creates the café that owns it.",
            "Come back here to rename it, staff it, or delete it.",
          ]}
          action={{ href: "/menus", label: "Go to My menus" }}
        />
      )}

      {error && (
        <p role="alert" className="text-xs text-danger-700">
          {error}
        </p>
      )}

      {selected && (
        <>
          <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
            <h3 className="text-sm font-bold tracking-tight text-ink-900">Name</h3>
            <p className="mt-1 text-xs leading-5 text-ink-500">
              Shown to your team and on your published menu pages.
            </p>
            <div className="mt-2 max-w-sm">
              {canManageSettings ? (
                <CommitInput
                  label={`Rename ${selected.name}`}
                  value={selected.name}
                  onCommit={(name) => void handleRename(name)}
                />
              ) : (
                <p className="text-sm font-semibold text-ink-900">{selected.name}</p>
              )}
            </div>
          </div>

          {canReadTeam && (
            <>
              <TeamCard
                key={selected.id}
                restaurantId={selected.id}
                restaurantName={selected.name}
                currentUserId={currentUserId}
                canManage={canManageTeam}
                onTeamChanged={() => setTeamVersion((version) => version + 1)}
              />

              <TeamActivity
                key={`activity-${selected.id}`}
                restaurantId={selected.id}
                refreshKey={teamVersion}
              />
            </>
          )}

          <OrderAlertsCard
            key={`alerts-${selected.id}`}
            restaurantId={selected.id}
            restaurantName={selected.name}
            canManage={canManageSettings}
          />

          {canManageSettings && (
            <div className="rounded-2xl border border-danger-200 bg-danger-50 p-5">
              <h3 className="text-sm font-bold tracking-tight text-danger-900">Danger zone</h3>
              <p className="mt-1 text-xs leading-5 text-danger-800">
                Deleting “{selected.name}” removes its menus, published pages and orders from your
                account. This cannot be undone.
              </p>
              <button
                type="button"
                onClick={() => void handleDeleteRestaurant()}
                disabled={deleting}
                className="mt-3 rounded-full border border-danger-700 px-4 py-1.5 text-sm font-semibold text-danger-800 transition-colors hover:bg-danger-700 hover:text-on-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
              >
                {deleting ? "Deleting…" : `Delete ${selected.name}`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Usage is the capture allowance, so it follows Capture's permission: a
          membership that may not upload menus has no extraction spend to see.
          The account export/delete stays available to every signed-in user;
          both cards self-gate on the session, so there is no dead UI while it
          resolves. */}
      {signedIn && (
        <>
          {canCapture && <UsagePanel restaurantId={selected?.id ?? null} />}
          <DataControls />
        </>
      )}
      {dialog}
    </div>
  );
}

/**
 * The offer a staff member sees: they are helping at someone else's café and
 * this account owns none of its own. One café per account, so the card is
 * only true while the owned list is empty; once a café is added, the switcher
 * at the top of the page is where the two are traded.
 */
function OwnRestaurantCard() {
  const workspace = useWorkspace();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const active = workspace.active;
  const helping = active?.role === "staff" && workspace.owned.length === 0;
  const settled = workspace.restaurants !== null && workspace.failedFor === null;
  // A created café keeps the card until the page is left, so the answer to
  // "did that work?" is visible even though the offer itself no longer applies.
  if (!created && (!helping || !settled)) return null;

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    try {
      const restaurant = await createRestaurant(trimmed);
      workspace.addRestaurant(restaurant);
      setCreated(restaurant.name);
      setName("");
    } catch (cause) {
      if (cause instanceof SyncError && cause.code === "conflict") {
        // One café per account: the existing one is the answer, so let the
        // provider re-read instead of leaving a stale empty owned list.
        workspace.refresh();
        setError(
          "This account already owns a restaurant. It will appear in the switcher at the top."
        );
      } else if (cause instanceof SyncError && cause.code === "unauthorized") {
        setError("Sign in again to add a restaurant.");
      } else {
        setError("Could not create the restaurant. Check your connection and try again.");
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="rounded-2xl border border-accent-200 bg-accent-50 p-5">
      <h3 className="text-sm font-bold tracking-tight text-accent-900">Your own restaurant</h3>
      {created ? (
        <p className="mt-1 text-xs leading-5 text-accent-900">
          “{created}” is on this account. Switch between it and {active?.name ?? "the café you help"}{" "}
          from the top of the page.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs leading-5 text-accent-900">
            You’re helping at {active?.name ?? "this café"}. Running your own place too? Add it and
            you can switch between them from the top of the page.
          </p>
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
          >
            <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-accent-900">
              Restaurant name
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Sunny Side Café"
                maxLength={120}
                className="rounded-lg border border-line-300 bg-surface-base px-3 py-1.5 text-sm text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              />
            </label>
            <button
              type="submit"
              disabled={creating || name.trim().length === 0}
              className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              {creating ? "Creating…" : "Create my restaurant"}
            </button>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger-700">
          {error}
        </p>
      )}
    </section>
  );
}

interface TeamCardProps {
  restaurantId: string;
  restaurantName: string;
  currentUserId: string | null;
  /** True with `team.manage`: the owner's add/role/remove controls. */
  canManage: boolean;
  /** Called after a change lands, so the audit trail can reload. */
  onTeamChanged: () => void;
}

/** The team list plus add/role/remove controls, scoped to one restaurant. */
function TeamCard({
  restaurantId,
  restaurantName,
  currentUserId,
  canManage,
  onTeamChanged,
}: TeamCardProps) {
  const { confirm, dialog } = useConfirm();
  const [members, setMembers] = useState<MemberOption[] | null>(null);
  const [pending, setPending] = useState<PendingInvitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<"owner" | "staff">("staff");
  const [adding, setAdding] = useState(false);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const [pendingBusy, setPendingBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchMembers(restaurantId);
        if (!cancelled) setMembers(list);
      } catch {
        if (!cancelled) setError("Could not load the team. Check your connection and try again.");
      }
    })();
    // Pending invitations are owner chrome: a reader never asks for them.
    if (canManage) {
      void (async () => {
        try {
          const list = await fetchPendingInvitations(restaurantId);
          if (!cancelled) setPending(list);
        } catch {
          if (!cancelled) setPending([]);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [restaurantId, canManage]);

  async function refreshPending() {
    try {
      setPending(await fetchPendingInvitations(restaurantId));
    } catch {
      // Keep whatever list we had; the next load will retry.
    }
  }

  async function handleResend(invitation: PendingInvitation) {
    if (pendingBusy) return;
    setPendingBusy(invitation.id);
    setError(null);
    setNotice(null);
    try {
      await resendInvitation(restaurantId, invitation.id);
      setNotice(
        `Invitation re-sent to ${invitation.email}. The previous link no longer works.`
      );
    } catch (resendError) {
      setError(
        resendError instanceof Error ? resendError.message : "Could not resend the invitation."
      );
    } finally {
      setPendingBusy(null);
      // The link is rotated before the email is sent, so a failed delivery
      // still changed the row (and left an audit event) — re-read both.
      await refreshPending();
      onTeamChanged();
    }
  }

  async function handleRevoke(invitation: PendingInvitation) {
    if (pendingBusy) return;
    setPendingBusy(invitation.id);
    setError(null);
    setNotice(null);
    try {
      await revokeInvitation(restaurantId, invitation.id);
      setPending((prev) => prev?.filter((row) => row.id !== invitation.id) ?? prev);
      setNotice(`Invitation to ${invitation.email} revoked. The emailed link no longer works.`);
    } catch (revokeError) {
      setError(
        revokeError instanceof Error ? revokeError.message : "Could not revoke the invitation."
      );
    } finally {
      setPendingBusy(null);
      onTeamChanged();
    }
  }

  async function handleAddMember() {
    const email = addEmail.trim();
    if (!email || adding) return;
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addMember(restaurantId, email, addRole);
      if (result.kind === "member") {
        setMembers((prev) => [...(prev ?? []), result.member]);
        setNotice(`${result.member.name} joined as ${result.member.role}.`);
      } else {
        setNotice(
          `Invitation emailed to ${result.invitation.email}. They'll join as ${result.invitation.role} once they accept it.`
        );
      }
      setAddEmail("");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add the member. Try again.");
    } finally {
      setAdding(false);
      // A failed delivery can still leave a pending invitation (the row is
      // written before the email is sent) — show it so it can be resent or
      // revoked instead of silently lingering, and reload the trail since
      // the invitation itself was recorded.
      await refreshPending();
      onTeamChanged();
    }
  }

  async function handleRoleChange(member: MemberOption, role: "owner" | "staff") {
    if (memberBusy) return;
    setMemberBusy(member.userId);
    setError(null);
    try {
      const updated = await updateMemberRole(restaurantId, member.userId, role);
      setMembers((prev) => prev?.map((m) => (m.userId === updated.userId ? updated : m)) ?? prev);
      onTeamChanged();
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : "Could not change the role. Try again.");
      try {
        // The row must show the server's truth after a refused change.
        setMembers(await fetchMembers(restaurantId));
      } catch {
        // Keep the error message; the list may be one edit behind.
      }
    } finally {
      setMemberBusy(null);
    }
  }

  async function handleRemoveMember(member: MemberOption) {
    if (memberBusy) return;
    const ok = await confirm({
      message: `Remove “${member.name}” from ${restaurantName}? They lose access to its menus and orders.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setMemberBusy(member.userId);
    setError(null);
    try {
      await removeMember(restaurantId, member.userId);
      setMembers((prev) => prev?.filter((m) => m.userId !== member.userId) ?? prev);
      onTeamChanged();
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : "Could not remove the member. Try again."
      );
    } finally {
      setMemberBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
      <h3 className="text-sm font-bold tracking-tight text-ink-900">Team</h3>
      <p className="mt-1 text-xs leading-5 text-ink-500">
        {canManage
          ? "Owners can change menus, publish and manage the team. Staff see the order board and the menus."
          : "Everyone at this café can see who works here. An owner can change roles or invite someone new."}
      </p>

      {canManage && (
      <>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-ink-600">
          Add by email
          <input
            type="email"
            value={addEmail}
            onChange={(event) => setAddEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleAddMember();
            }}
            placeholder="teammate@cafe.com"
            className="rounded-lg border border-line-300 px-3 py-1.5 text-sm text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
          Role
          <select
            value={addRole}
            onChange={(event) => setAddRole(event.target.value as "owner" | "staff")}
            className="rounded-lg border border-line-300 bg-surface-base px-3 py-1.5 text-sm text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void handleAddMember()}
          disabled={adding || addEmail.trim().length === 0}
          className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          {adding ? "Adding…" : "Add member"}
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-ink-400">
        If they already have an account they join immediately; otherwise we email them a one-time
        invitation link that accepts on sign-in (expires in 7 days).
      </p>
      </>
      )}

      {error && <p className="mt-2 text-xs text-danger-700">{error}</p>}
      {notice && !error && <p className="mt-2 text-xs text-success-800">{notice}</p>}

      {members === null && !error && (
        <div role="status" aria-busy="true" className="mt-3 flex flex-col gap-2">
          <span className="sr-only">Loading the team…</span>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-center gap-3 rounded-xl border border-line-200 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-1.5 h-3 w-1/2" />
              </div>
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>
          ))}
        </div>
      )}

      {members !== null && (
        <ul className="mt-3 space-y-2">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line-200 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">
                  {member.name.trim() ? member.name : member.email}
                  {member.userId === currentUserId && (
                    <span className="ml-1 text-xs font-normal text-ink-400">(you)</span>
                  )}
                </p>
                <p className="truncate text-xs text-ink-500">{member.email}</p>
              </div>
              {canManage ? (
                <>
                  <select
                    value={member.role}
                    onChange={(event) =>
                      void handleRoleChange(member, event.target.value as "owner" | "staff")
                    }
                    disabled={memberBusy === member.userId}
                    aria-label={`Role for ${member.name}`}
                    className="rounded-lg border border-line-300 bg-surface-base px-2 py-1 text-xs text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="owner">Owner</option>
                    <option value="staff">Staff</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleRemoveMember(member)}
                    disabled={memberBusy === member.userId}
                    className="rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="rounded-full bg-surface-100 px-2 py-1 text-xs font-medium text-ink-600">
                  {member.role === "owner" ? "Owner" : "Staff"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {pending !== null && pending.length > 0 && (
        <div className="mt-4 rounded-xl border border-warning-200 bg-warning-50 p-3">
          <p className="text-xs font-semibold tracking-wide text-warning-900 uppercase">
            Pending invitations
          </p>
          <ul className="mt-2 space-y-2">
            {pending.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {invitation.email}
                  </p>
                  <p className="text-[11px] leading-4 text-ink-500">
                    {invitation.role === "owner" ? "Owner" : "Staff"} · invited by{" "}
                    {invitation.invitedByName.trim() || "a teammate"} · expires{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleResend(invitation)}
                      disabled={pendingBusy === invitation.id}
                      className="rounded-full border border-line-300 bg-surface-base px-3 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRevoke(invitation)}
                      disabled={pendingBusy === invitation.id}
                      className="rounded-full border border-line-300 bg-surface-base px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
                    >
                      Revoke
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {dialog}
    </div>
  );
}
