import { sendInvitationEmail } from "@/lib/auth/email";
import { loopbackOrigin } from "@/lib/http/loopback";

import type { CreatedInvitation } from "./invitations";

/**
 * Shared plumbing for invitation emails (server-only). The route handlers
 * decide what to do when delivery fails; this module only builds the link
 * and hands the invitation to the existing Resend sender.
 */

/** Absolute accept URL for an invitation token. */
export function invitationAcceptUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/invitations/${encodeURIComponent(token)}`;
}

/**
 * The public origin used in emailed links (same base as auth links). A dev
 * server on another port uses that origin, so the recipient does not open a
 * dead 3200 link; production keeps BETTER_AUTH_URL.
 */
export function publicBaseUrl(request: Request): string {
  return loopbackOrigin(request) ?? process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
}

/** Email a freshly issued invitation token. */
export async function emailInvitation(
  created: CreatedInvitation,
  baseUrl: string
): Promise<void> {
  await sendInvitationEmail({
    email: created.invitation.email,
    restaurantName: created.restaurantName,
    inviterName: created.inviterName,
    role: created.invitation.role,
    url: invitationAcceptUrl(baseUrl, created.token),
  });
}
