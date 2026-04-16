import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { createLoginToken } from "../../../lib/auth.js";
import { getPool } from "../../../lib/database.js";

export const config = {
  runtime: "nodejs",
};

function getResendApiKey() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  return apiKey;
}

function getFromEmail() {
  const fromAddress = process.env.RESEND_FROM_EMAIL;

  if (!fromAddress) {
    throw new Error("RESEND_FROM_EMAIL is not set");
  }

  return fromAddress;
}

function buildLoginEmail(input: { loginUrl: string; inviteOrganizationName?: string | null }) {
  const subject = input.inviteOrganizationName
    ? `Sign in to join ${input.inviteOrganizationName}`
    : "Sign in to projectDNS2";
  const text = [
    input.inviteOrganizationName
      ? `You were invited to join ${input.inviteOrganizationName}.`
      : "Use the link below to sign in.",
    "",
    input.loginUrl,
    "",
    "This sign-in link expires in 20 minutes.",
  ].join("\n");

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; line-height: 1.5; color: #0f172a;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">${subject}</h1>
      <p style="margin: 0 0 16px;">Use the link below to continue:</p>
      <p style="margin: 0 0 16px;"><a href="${input.loginUrl}">${input.loginUrl}</a></p>
      <p style="margin: 0;">This sign-in link expires in 20 minutes.</p>
    </div>
  `.trim();

  return { subject, text, html };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const { email, name } = req.body ?? {};
    const normalizedEmail = String(email ?? "")
      .trim()
      .toLowerCase();
    const normalizedName = String(name ?? "").trim();

    if (!normalizedEmail) {
      res.status(400).json({ ok: false, error: "email is required" });
      return;
    }

    const inviteResult = await getPool().query(
      `select i.organization_id as "organizationId", o.name as "organizationName"
       from invitations i
       inner join organizations o on o.id = i.organization_id
       where lower(i.email) = $1 and i.status = 'pending'
       order by i.created_at desc
       limit 1`,
      [normalizedEmail],
    );

    const pendingInvite = inviteResult.rows[0] as
      | { organizationId: string; organizationName: string }
      | undefined;

    const loginToken = await createLoginToken({
      email: normalizedEmail,
      name: normalizedName || undefined,
      inviteOrganizationId: pendingInvite?.organizationId ?? null,
    });

    const resend = new Resend(getResendApiKey());
    const emailMessage = buildLoginEmail({
      loginUrl: loginToken.loginUrl,
      inviteOrganizationName: pendingInvite?.organizationName ?? null,
    });

    const sendResult = await resend.emails.send({
      from: getFromEmail(),
      to: normalizedEmail,
      subject: emailMessage.subject,
      text: emailMessage.text,
      html: emailMessage.html,
    });

    if (sendResult.error) {
      throw new Error(sendResult.error.message);
    }

    res.status(200).json({
      ok: true,
      email: normalizedEmail,
      inviteOrganizationName: pendingInvite?.organizationName ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown auth login error";
    console.error("api/auth/login failed", {
      method: req.method,
      body: req.body,
      error,
    });
    res.status(500).json({ ok: false, error: message });
  }
}
