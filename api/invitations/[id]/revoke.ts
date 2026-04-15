import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  queryWithRls,
  requireRequestContext,
  UnauthorizedError,
} from "../../../lib/request-context.ts";

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
    const invitationId = String(getSingleQueryValue(req.query.id)).trim();

    if (!invitationId) {
      res.status(400).json({ ok: false, error: "Invitation id is required" });
      return;
    }

    const invitationLookup = await queryWithRls({
      userId: context.currentUser.id,
      userEmail: context.currentUser.email,
      text: `select id, organization_id as "organizationId", status
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

    const membership = context.memberships.find(
      (item) => item.organizationId === invitation.organizationId,
    );

    if (!membership || membership.role !== "admin") {
      res.status(403).json({ ok: false, error: "Only organization admins can revoke invitations" });
      return;
    }

    if (invitation.status !== "pending") {
      res.status(409).json({ ok: false, error: "Only pending invitations can be revoked" });
      return;
    }

    const revokeResult = await queryWithRls({
      userId: context.currentUser.id,
      userEmail: context.currentUser.email,
      organizationId: invitation.organizationId,
      text: `update invitations
             set status = 'revoked'
             where id = $1 and status = 'pending'
             returning id, organization_id as "organizationId", email, role, status,
                       invited_by_user_id as "invitedByUserId", created_at as "createdAt"`,
      values: [invitationId],
    });

    if (revokeResult.rowCount === 0) {
      res.status(409).json({ ok: false, error: "Invitation could not be revoked" });
      return;
    }

    res.status(200).json({ ok: true, invitation: revokeResult.rows[0] });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(401).json({ ok: false, error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown revoke invitation error";
    console.error("api/invitations/[id]/revoke failed", {
      method: req.method,
      query: req.query,
      error,
    });
    res.status(200).json({ ok: false, error: message });
  }
}
