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
    const context = await requireRequestContext(req);
    const organizationId =
      String(getSingleQueryValue(req.query.id)).trim() || context.activeOrganization?.id;

    if (!organizationId) {
      res.status(200).json({ ok: true, members: [] });
      return;
    }

    const activeMembership = context.memberships.find(
      (membership) => membership.organizationId === organizationId,
    );

    if (!activeMembership) {
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

    if (req.method === "GET") {
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
      return;
    }

    if (activeMembership.role !== "admin") {
      res.status(403).json({ ok: false, error: "Only organization admins can manage members" });
      return;
    }

    if (req.method === "PATCH") {
      const { memberId, role } = req.body ?? {};

      if (!memberId || (role !== "admin" && role !== "user")) {
        res.status(400).json({ ok: false, error: "memberId and valid role are required" });
        return;
      }

      const targetMemberResult = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        organizationId,
        text: `select id, user_id as "userId", role
               from organization_members
               where id = $1 and organization_id = $2
               limit 1`,
        values: [String(memberId).trim(), organizationId],
      });

      const targetMember = targetMemberResult.rows[0] as
        | { id: string; userId: string; role: "admin" | "user" }
        | undefined;

      if (!targetMember) {
        res.status(404).json({ ok: false, error: "Member not found" });
        return;
      }

      if (targetMember.userId === context.currentUser.id && role !== "admin") {
        res.status(409).json({ ok: false, error: "You cannot remove your own admin role" });
        return;
      }

      const updatedMemberResult = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        organizationId,
        text: `update organization_members
               set role = $1
               where id = $2 and organization_id = $3
               returning id, organization_id as "organizationId", user_id as "userId", role,
                         created_at as "createdAt"`,
        values: [role, targetMember.id, organizationId],
      });

      res.status(200).json({ ok: true, member: updatedMemberResult.rows[0] });
      return;
    }

    if (req.method === "DELETE") {
      const memberId = String(getSingleQueryValue(req.query.memberId)).trim();

      if (!memberId) {
        res.status(400).json({ ok: false, error: "memberId is required" });
        return;
      }

      const targetMemberResult = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        organizationId,
        text: `select id, user_id as "userId", role
               from organization_members
               where id = $1 and organization_id = $2
               limit 1`,
        values: [memberId, organizationId],
      });

      const targetMember = targetMemberResult.rows[0] as
        | { id: string; userId: string; role: "admin" | "user" }
        | undefined;

      if (!targetMember) {
        res.status(404).json({ ok: false, error: "Member not found" });
        return;
      }

      if (targetMember.userId === context.currentUser.id) {
        res
          .status(409)
          .json({ ok: false, error: "You cannot remove yourself from the organization" });
        return;
      }

      if (targetMember.role === "admin") {
        const adminCountResult = await queryWithRls({
          userId: context.currentUser.id,
          userEmail: context.currentUser.email,
          organizationId,
          text: `select count(*)::int as count
                 from organization_members
                 where organization_id = $1 and role = 'admin'`,
          values: [organizationId],
        });

        if ((adminCountResult.rows[0]?.count ?? 0) <= 1) {
          res.status(409).json({ ok: false, error: "Organization must keep at least one admin" });
          return;
        }
      }

      const deletedMemberResult = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        organizationId,
        text: `delete from organization_members
               where id = $1 and organization_id = $2
               returning id, organization_id as "organizationId", user_id as "userId", role`,
        values: [memberId, organizationId],
      });

      res.status(200).json({ ok: true, member: deletedMemberResult.rows[0] ?? null });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
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
