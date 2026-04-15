import type { VercelRequest } from "@vercel/node";
import { Pool } from "pg";

let pool: Pool | undefined;
const FALLBACK_USER_EMAIL = "test@example.com";

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

function getSingleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export type RequestContext = {
  currentUser: {
    id: string;
    email: string;
    name: string;
  };
  memberships: Array<{
    organizationId: string;
    role: "admin" | "user";
    organizationName: string;
    organizationSlug: string;
  }>;
  activeOrganization: {
    id: string;
    name: string;
    slug: string;
    role: "admin" | "user";
  };
};

async function getFallbackUser(db: Pool) {
  const fallbackUserResult = await db.query(
    "select id, email, name from users where email = $1 limit 1",
    [FALLBACK_USER_EMAIL],
  );

  return fallbackUserResult.rows[0];
}

export async function getRequestContext(req: VercelRequest): Promise<RequestContext> {
  const db = getPool();
  const requestedUserEmail = String(req.headers["x-user-email"] ?? "").trim();
  const userEmail = requestedUserEmail || FALLBACK_USER_EMAIL;

  const currentUserResult = await db.query(
    "select id, email, name from users where email = $1 limit 1",
    [userEmail],
  );

  const currentUser = currentUserResult.rows[0] ?? (await getFallbackUser(db));

  if (!currentUser) {
    console.error("request-context could not resolve current user", {
      requestedUserEmail,
      fallbackUserEmail: FALLBACK_USER_EMAIL,
    });

    return {
      currentUser: {
        id: "",
        email: userEmail,
        name: "Unknown User",
      },
      memberships: [],
      activeOrganization: {
        id: "",
        name: "No Organization",
        slug: "",
        role: "user",
      },
    };
  }

  const membershipsResult = await db.query(
    `select om.organization_id as "organizationId", om.role,
            o.name as "organizationName", o.slug as "organizationSlug"
     from organization_members om
     inner join organizations o on o.id = om.organization_id
     where om.user_id = $1
     order by o.created_at asc`,
    [currentUser.id],
  );

  const memberships = membershipsResult.rows as RequestContext["memberships"];

  if (memberships.length === 0) {
    console.error("request-context found user without memberships", {
      currentUserId: currentUser.id,
      currentUserEmail: currentUser.email,
    });

    return {
      currentUser,
      memberships: [],
      activeOrganization: {
        id: "",
        name: "No Organization",
        slug: "",
        role: "user",
      },
    };
  }

  const headerOrganizationId = String(req.headers["x-organization-id"] ?? "").trim();
  const queryOrganizationId = String(getSingleValue(req.query.organizationId)).trim();
  const body = req.body as { organizationId?: string } | undefined;
  const bodyOrganizationId = String(body?.organizationId ?? "").trim();
  const requestedOrganizationId = headerOrganizationId || queryOrganizationId || bodyOrganizationId;

  const activeMembership =
    memberships.find((membership) => membership.organizationId === requestedOrganizationId) ??
    memberships[0];

  if (!activeMembership) {
    console.error("request-context could not resolve active organization", {
      requestedOrganizationId,
      currentUserId: currentUser.id,
    });

    return {
      currentUser,
      memberships,
      activeOrganization: {
        id: memberships[0]?.organizationId ?? "",
        name: memberships[0]?.organizationName ?? "No Organization",
        slug: memberships[0]?.organizationSlug ?? "",
        role: memberships[0]?.role ?? "user",
      },
    };
  }

  return {
    currentUser,
    memberships,
    activeOrganization: {
      id: activeMembership.organizationId,
      name: activeMembership.organizationName,
      slug: activeMembership.organizationSlug,
      role: activeMembership.role,
    },
  };
}
