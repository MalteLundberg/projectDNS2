import type { VercelRequest } from "@vercel/node";
import type { PoolClient, QueryResultRow } from "pg";
import { getPool } from "./database";

type CurrentUser = {
  id: string;
  email: string;
  name: string;
};

type Membership = {
  organizationId: string;
  role: "admin" | "user";
  organizationName: string;
  organizationSlug: string;
};

type ActiveOrganization = {
  id: string;
  name: string;
  slug: string;
  role: "admin" | "user";
};

export type RequestContext = {
  currentUser: CurrentUser | null;
  memberships: Membership[];
  activeOrganization: ActiveOrganization | null;
  sessionToken: string | null;
};

export type AuthenticatedRequestContext = Omit<RequestContext, "currentUser" | "sessionToken"> & {
  currentUser: CurrentUser;
  sessionToken: string;
};

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function parseCookies(headerValue: string | undefined) {
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

function getSingleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export function createSessionCookie(name: string, value: string, maxAgeSeconds: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function createActiveOrganizationCookie(organizationId: string, maxAgeSeconds: number) {
  return `active_organization_id=${encodeURIComponent(organizationId)}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export async function withRlsContext<T>(
  input: {
    userId: string;
    userEmail?: string | null;
    organizationId?: string | null;
  },
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    await client.query("select set_config('app.current_user_id', $1, true)", [input.userId]);
    await client.query("select set_config('app.current_user_email', $1, true)", [
      input.userEmail ?? "",
    ]);
    await client.query("select set_config('app.current_organization_id', $1, true)", [
      input.organizationId ?? "",
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

export async function getRequestContext(req: VercelRequest): Promise<RequestContext> {
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = String(cookies.app_session ?? "").trim();
  const query = (req.query ?? {}) as Record<string, string | string[] | undefined>;
  const body = (req.body ?? {}) as { organizationId?: string };

  if (!sessionToken) {
    return {
      currentUser: null,
      memberships: [],
      activeOrganization: null,
      sessionToken: null,
    };
  }

  const client = await getPool().connect();

  try {
    const sessionResult = await client.query(
      `select us.session_token as "sessionToken", us.expires_at as "expiresAt",
              u.id, u.email, u.name
       from user_sessions us
       inner join users u on u.id = us.user_id
       where us.session_token = $1 and us.expires_at > now()
       limit 1`,
      [sessionToken],
    );

    const currentUser = (sessionResult.rows[0] ?? null) as CurrentUser | null;

    if (!currentUser) {
      return {
        currentUser: null,
        memberships: [],
        activeOrganization: null,
        sessionToken: null,
      };
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

    const memberships = membershipsResult.rows as Membership[];
    const cookieOrganizationId = String(cookies.active_organization_id ?? "").trim();
    const queryOrganizationId = String(getSingleValue(query.organizationId)).trim();
    const bodyOrganizationId = String(body.organizationId ?? "").trim();
    const requestedOrganizationId =
      cookieOrganizationId || queryOrganizationId || bodyOrganizationId;

    const activeMembership =
      memberships.find((membership) => membership.organizationId === requestedOrganizationId) ??
      memberships[0] ??
      null;

    return {
      currentUser,
      memberships,
      activeOrganization: activeMembership
        ? {
            id: activeMembership.organizationId,
            name: activeMembership.organizationName,
            slug: activeMembership.organizationSlug,
            role: activeMembership.role,
          }
        : null,
      sessionToken,
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

export async function requireRequestContext(
  req: VercelRequest,
): Promise<AuthenticatedRequestContext> {
  const context = await getRequestContext(req);

  if (!context.currentUser?.id || !context.sessionToken) {
    throw new UnauthorizedError();
  }

  return {
    ...context,
    currentUser: context.currentUser,
    sessionToken: context.sessionToken,
  };
}

export async function queryWithRls<T extends QueryResultRow = QueryResultRow>(input: {
  userId: string;
  userEmail?: string | null;
  organizationId?: string | null;
  text: string;
  values?: unknown[];
}) {
  return withRlsContext(
    {
      userId: input.userId,
      userEmail: input.userEmail,
      organizationId: input.organizationId,
    },
    (client) => client.query<T>(input.text, input.values ?? []),
  );
}
