import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  queryWithRls,
  requireRequestContext,
  UnauthorizedError,
} from "../../../lib/request-context.js";

export const config = {
  runtime: "nodejs",
};

function getSingleQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const context = await requireRequestContext(req);
    const currentUser = context.currentUser;
    const invitationId = String(getSingleQueryValue(req.query.id)).trim();

    if (!invitationId) {
      res.status(400).json({ ok: false, error: "Invitation id is required" });
      return;
    }

    const invitationLookup = await queryWithRls({
      userId: currentUser.id,
      userEmail: currentUser.email,
      text: `select id, organization_id as "organizationId", email, role, status
             from invitations
             where id = $1
             limit 1`,
      values: [invitationId],
    });

    const invitation = invitationLookup.rows[0];

    if (!invitation) {
      res.status(404).json({ ok: false, error: "Invitation not found" });
      return;
    }

    if (invitation.status !== "pending") {
      res.status(409).json({ ok: false, error: "Only pending invitations can be accepted" });
      return;
    }

    if (String(invitation.email).toLowerCase() !== String(currentUser.email).toLowerCase()) {
      res.status(403).json({ ok: false, error: "Invitation does not belong to current user" });
      return;
    }

    const result = await queryWithRls({
      userId: currentUser.id,
      userEmail: currentUser.email,
      organizationId: invitation.organizationId,
      text: `with existing_membership as (
               select id, organization_id as "organizationId", user_id as "userId", role,
                      created_at as "createdAt"
               from organization_members
               where organization_id = $1 and user_id = $2
               limit 1
             ), inserted_membership as (
               insert into organization_members (organization_id, user_id, role)
               select $1, $2, $3
               where not exists (select 1 from existing_membership)
               on conflict (organization_id, user_id) do nothing
               returning id, organization_id as "organizationId", user_id as "userId", role,
                         created_at as "createdAt"
             ), accepted_invitation as (
               update invitations
               set status = 'accepted'
               where id = $4 and status = 'pending'
               returning id, organization_id as "organizationId", email, role, status,
                         invited_by_user_id as "invitedByUserId", created_at as "createdAt"
             )
             select row_to_json(accepted_invitation.*) as invitation,
                    row_to_json(coalesce(inserted_membership, existing_membership)) as membership
             from accepted_invitation
             left join inserted_membership on true
             left join existing_membership on inserted_membership.id is null`,
      values: [invitation.organizationId, currentUser.id, invitation.role, invitationId],
    });

    const payload = result.rows[0] as
      | {
          invitation: Record<string, unknown> | null;
          membership: Record<string, unknown> | null;
        }
      | undefined;

    if (!payload?.invitation) {
      res.status(409).json({ ok: false, error: "Invitation could not be accepted" });
      return;
    }

    res
      .status(200)
      .json({ ok: true, invitation: payload.invitation, membership: payload.membership });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(401).json({ ok: false, error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown accept invitation error";
    console.error("api/invitations/[id]/accept failed", {
      method: req.method,
      query: req.query,
      error,
    });
    res.status(200).json({ ok: false, error: message });
  }
}
