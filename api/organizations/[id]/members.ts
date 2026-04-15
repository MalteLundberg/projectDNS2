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
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const context = await requireRequestContext(req);
    const organizationId =
      String(getSingleQueryValue(req.query.id)).trim() || context.activeOrganization?.id;

    if (!organizationId) {
      res.status(200).json({ ok: true, members: [] });
      return;
    }

    if (!context.memberships.some((membership) => membership.organizationId === organizationId)) {
      res.status(403).json({ ok: false, members: [], error: "Access denied for organization" });
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

    const membersResult = await queryWithRls({
      userId: context.currentUser.id,
      userEmail: context.currentUser.email,
      organizationId,
      text: `select om.id, om.role, om.created_at as "createdAt",
                    u.id as "userId", u.name as "userName", u.email as "userEmail"
             from organization_members om
             inner join users u on om.user_id = u.id
             where om.organization_id = $1
             order by u.name asc`,
      values: [organizationId],
    });

    res.status(200).json({ ok: true, members: membersResult.rows });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(401).json({ ok: false, members: [], error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown members error";
    console.error("api/organizations/[id]/members failed", {
      method: req.method,
      query: req.query,
      error,
    });
    res.status(200).json({ ok: false, members: [], error: message });
  }
}
