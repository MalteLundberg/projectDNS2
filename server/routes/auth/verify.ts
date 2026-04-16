import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consumeLoginToken, createLoginSuccessCookies } from "../../../lib/auth.js";
import { getPool } from "../../../lib/database.js";

export const config = {
  runtime: "nodejs",
};

function getSingleQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function getRedirectBase() {
  const appUrl = process.env.APP_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "";

  if (!appUrl) {
    return "/";
  }

  return appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const token = String(getSingleQueryValue(req.query.token)).trim();

    if (!token) {
      res.status(400).send("Missing token");
      return;
    }

    const loginResult = await consumeLoginToken(token);

    if (!loginResult) {
      res.status(400).send("Login link is invalid or expired");
      return;
    }

    let activeOrganizationId: string | null = loginResult.inviteOrganizationId ?? null;

    if (!activeOrganizationId) {
      const membershipResult = await getPool().query(
        `select organization_id as "organizationId"
         from organization_members
         where user_id = $1
         order by created_at asc
         limit 1`,
        [loginResult.user.id],
      );

      activeOrganizationId = membershipResult.rows[0]?.organizationId ?? null;
    }

    res.setHeader(
      "Set-Cookie",
      createLoginSuccessCookies({
        sessionToken: loginResult.sessionToken,
        activeOrganizationId,
      }),
    );
    res.writeHead(302, { Location: `${getRedirectBase().replace(/\/$/, "")}/` });
    res.end();
  } catch (error) {
    console.error("api/auth/verify failed", {
      method: req.method,
      query: req.query,
      error,
    });
    res.status(500).send("Unable to complete sign in");
  }
}
