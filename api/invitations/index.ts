import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { queryWithRls, requireRequestContext, UnauthorizedError } from "../../lib/request-context";

export const config = {
  runtime: "nodejs",
};

function getSingleQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function getResendApiKey() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  return apiKey;
}

function getInvitationFromAddress() {
  const fromAddress = process.env.RESEND_FROM_EMAIL;

  if (!fromAddress) {
    throw new Error("RESEND_FROM_EMAIL is not set");
  }

  return fromAddress;
}

function buildInvitationEmail(input: {
  organizationName: string;
  inviterName: string;
  inviteeEmail: string;
  role: "admin" | "user";
}) {
  const subject = `Invitation to join ${input.organizationName}`;
  const text = [
    `You have been invited to join ${input.organizationName}.`,
    "",
    `Invited by: ${input.inviterName}`,
    `Email: ${input.inviteeEmail}`,
    `Role: ${input.role}`,
    "",
    "You can sign in to the application and accept the invitation from there.",
  ].join("\n");

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; line-height: 1.5; color: #0f172a;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">You are invited to join ${input.organizationName}</h1>
      <p style="margin: 0 0 12px;">${input.inviterName} invited <strong>${input.inviteeEmail}</strong> to join <strong>${input.organizationName}</strong>.</p>
      <p style="margin: 0 0 12px;">Role: <strong>${input.role}</strong></p>
      <p style="margin: 0;">Sign in to the application and accept the invitation from there.</p>
    </div>
  `.trim();

  return { subject, text, html };
}

async function sendInvitationEmail(input: {
  organizationName: string;
  inviterName: string;
  inviteeEmail: string;
  role: "admin" | "user";
}) {
  const resend = new Resend(getResendApiKey());
  const email = buildInvitationEmail(input);
  const result = await resend.emails.send({
    from: getInvitationFromAddress(),
    to: input.inviteeEmail,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const context = await requireRequestContext(req);

    if (req.method === "GET") {
      const organizationId =
        String(getSingleQueryValue(req.query.organizationId)).trim() ||
        context.activeOrganization?.id;

      if (!organizationId) {
        res.status(200).json({ ok: true, invitations: [] });
        return;
      }

      const organizationResult = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        organizationId,
        text: "select id from organizations where id = $1 limit 1",
        values: [organizationId],
      });

      if (organizationResult.rowCount === 0) {
        res.status(404).json({ ok: false, error: "Organization not found" });
        return;
      }

      const invitationsResult = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        organizationId,
        text: `select id, organization_id as "organizationId", email, role, status,
                      invited_by_user_id as "invitedByUserId", created_at as "createdAt"
               from invitations
               where organization_id = $1
               order by created_at desc`,
        values: [organizationId],
      });

      res.status(200).json({ ok: true, invitations: invitationsResult.rows });
      return;
    }

    if (req.method === "POST") {
      const { organizationId, email, role } = req.body ?? {};

      if (!email || !role) {
        res.status(400).json({ ok: false, error: "email and role are required" });
        return;
      }

      if (role !== "admin" && role !== "user") {
        res.status(400).json({ ok: false, error: "role must be admin or user" });
        return;
      }

      const normalizedOrganizationId = String(
        organizationId ?? context.activeOrganization?.id,
      ).trim();
      const activeMembership = context.memberships.find(
        (membership) => membership.organizationId === normalizedOrganizationId,
      );

      if (!activeMembership || activeMembership.role !== "admin") {
        res
          .status(403)
          .json({ ok: false, error: "Only organization admins can create invitations" });
        return;
      }

      const organizationResult = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        organizationId: normalizedOrganizationId,
        text: "select id from organizations where id = $1 limit 1",
        values: [normalizedOrganizationId],
      });

      if (organizationResult.rowCount === 0) {
        res.status(404).json({ ok: false, error: "Organization not found" });
        return;
      }

      const inviterMembershipResult = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        organizationId: normalizedOrganizationId,
        text: "select id from organization_members where organization_id = $1 and user_id = $2 limit 1",
        values: [normalizedOrganizationId, context.currentUser.id],
      });

      if (inviterMembershipResult.rowCount === 0) {
        res.status(403).json({ ok: false, error: "Inviter is not a member of the organization" });
        return;
      }

      const existingInvitationResult = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        organizationId: normalizedOrganizationId,
        text: `select id, status
               from invitations
               where organization_id = $1 and email = $2
               order by created_at desc
               limit 1`,
        values: [normalizedOrganizationId, String(email).trim()],
      });

      const existingInvitation = existingInvitationResult.rows[0];

      if (existingInvitation?.status === "pending") {
        res
          .status(409)
          .json({ ok: false, error: "A pending invitation already exists for this email" });
        return;
      }

      const invitationResult = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        organizationId: normalizedOrganizationId,
        text: `insert into invitations (organization_id, email, role, status, invited_by_user_id)
               values ($1, $2, $3, 'pending', $4)
               returning id, organization_id as "organizationId", email, role, status,
                         invited_by_user_id as "invitedByUserId", created_at as "createdAt"`,
        values: [normalizedOrganizationId, String(email).trim(), role, context.currentUser.id],
      });

      const invitation = invitationResult.rows[0];
      let mail = {
        sent: false as boolean,
        id: null as string | null,
        error: null as string | null,
      };

      try {
        const emailResult = await sendInvitationEmail({
          organizationName: activeMembership.organizationName,
          inviterName: context.currentUser.name,
          inviteeEmail: String(email).trim(),
          role,
        });

        mail = {
          sent: true,
          id: emailResult?.id ?? null,
          error: null,
        };
      } catch (mailError) {
        const mailMessage =
          mailError instanceof Error ? mailError.message : "Unknown invitation email error";
        console.error("api/invitations email send failed", {
          organizationId: normalizedOrganizationId,
          email,
          role,
          error: mailError,
        });

        mail = {
          sent: false,
          id: null,
          error: mailMessage,
        };
      }

      res.status(201).json({ ok: true, invitation, mail });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(401).json({ ok: false, invitations: [], error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown invitations error";
    console.error("api/invitations failed", {
      method: req.method,
      query: req.query,
      body: req.body,
      error,
    });
    res.status(200).json({ ok: false, invitations: [], error: message });
  }
}
