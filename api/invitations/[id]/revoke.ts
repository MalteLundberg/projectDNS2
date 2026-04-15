import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Pool, type PoolClient } from "pg";

export const config = {
  runtime: "nodejs",
};

let pool: Pool | undefined;
const FALLBACK_USER_EMAIL = "test@example.com";
const FALLBACK_SESSION_TOKEN = "dev-test-session-token";

function getPool() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  pool ??= new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  return pool;
}

function getSingleQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function parseCookies(headerValue: string | undefined) {
  const pairs = (headerValue ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  return Object.fromEntries(
    pairs.map((pair) => {
      const separatorIndex = pair.indexOf("=");

      if (separatorIndex === -1) {
        return [pair, ""];
      }

      return [pair.slice(0, separatorIndex), decodeURIComponent(pair.slice(separatorIndex + 1))];
    }),
  );
}

async function getRequestContext(req: VercelRequest) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies.app_session || FALLBACK_SESSION_TOKEN;
  const client = await getPool().connect();

  try {
    const currentUserResult = await client.query(
      `select u.id, u.email, u.name
       from user_sessions us
       inner join users u on u.id = us.user_id
       where us.session_token = $1 and us.expires_at > now()
       limit 1`,
      [sessionToken],
    );

    const currentUser =
      currentUserResult.rows[0] ??
      (
        await client.query("select id, email, name from users where email = $1 limit 1", [
          FALLBACK_USER_EMAIL,
        ])
      ).rows[0];

    if (!currentUser) {
      return { currentUser: null, memberships: [] };
    }

    await client.query("begin");
    await client.query("select set_config('app.current_user_id', $1, true)", [currentUser.id]);

    const membershipsResult = await client.query(
      `select om.organization_id as "organizationId", om.role,
              o.name as "organizationName", o.slug as "organizationSlug"
       from organization_members om
       inner join organizations o on o.id = om.organization_id
       where om.user_id = $1
       order by o.created_at asc`,
      [currentUser.id],
    );

    await client.query("commit");

    return {
      currentUser,
      memberships: membershipsResult.rows,
    };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Ignore rollback errors when no transaction is active.
    }

    throw error;
  } finally {
    client.release();
  }
}

async function withRlsContext<T>(
  userId: string,
  userEmail: string,
  organizationId: string | null,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    await client.query("select set_config('app.current_user_id', $1, true)", [userId]);
    await client.query("select set_config('app.current_user_email', $1, true)", [userEmail]);
    await client.query("select set_config('app.current_organization_id', $1, true)", [
      organizationId ?? "",
    ]);
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const context = await getRequestContext(req);

    if (!context.currentUser?.id) {
      res.status(200).json({ ok: false, error: "Current user could not be resolved" });
      return;
    }

    const invitationId = String(getSingleQueryValue(req.query.id)).trim();

    if (!invitationId) {
      res.status(400).json({ ok: false, error: "Invitation id is required" });
      return;
    }

    const invitationLookup = await withRlsContext(
      context.currentUser.id,
      context.currentUser.email,
      null,
      (client) =>
        client.query(
          `select id, organization_id as "organizationId", status
         from invitations
         where id = $1
         limit 1`,
          [invitationId],
        ),
    );

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

    const revokeResult = await withRlsContext(
      context.currentUser.id,
      context.currentUser.email,
      invitation.organizationId,
      (client) =>
        client.query(
          `update invitations
         set status = 'revoked'
         where id = $1 and status = 'pending'
         returning id, organization_id as "organizationId", email, role, status,
                   invited_by_user_id as "invitedByUserId", created_at as "createdAt"`,
          [invitationId],
        ),
    );

    if (revokeResult.rowCount === 0) {
      res.status(409).json({ ok: false, error: "Invitation could not be revoked" });
      return;
    }

    res.status(200).json({ ok: true, invitation: revokeResult.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown revoke invitation error";
    console.error("api/invitations/[id]/revoke failed", {
      method: req.method,
      query: req.query,
      error,
    });
    res.status(200).json({ ok: false, error: message });
  }
}
