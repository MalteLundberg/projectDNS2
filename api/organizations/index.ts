import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  queryWithRls,
  requireRequestContext,
  UnauthorizedError,
} from "../../lib/request-context.ts";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const context = await requireRequestContext(req);

    if (req.method === "GET") {
      if (context.memberships.length === 0) {
        res.status(200).json({ ok: true, organizations: [] });
        return;
      }

      const result = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        text: `select id, name, slug, created_by_user_id as "createdByUserId", created_at as "createdAt"
               from organizations
               order by created_at asc`,
      });

      res.status(200).json({ ok: true, organizations: result.rows });
      return;
    }

    if (req.method === "POST") {
      const { name, slug } = req.body ?? {};

      if (!name || !slug) {
        res.status(400).json({
          ok: false,
          error: "name and slug are required",
        });
        return;
      }

      const normalizedSlug = String(slug).trim();
      const existingOrganizationResult = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        text: "select id from organizations where slug = $1 limit 1",
        values: [normalizedSlug],
      });

      if (existingOrganizationResult.rowCount !== 0) {
        res.status(409).json({ ok: false, error: "Organization slug already exists" });
        return;
      }

      const organizationResult = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        text: `insert into organizations (name, slug, created_by_user_id)
               values ($1, $2, $3)
               returning id, name, slug, created_by_user_id as "createdByUserId", created_at as "createdAt"`,
        values: [String(name).trim(), normalizedSlug, context.currentUser.id],
      });

      const organization = organizationResult.rows[0];

      await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        organizationId: organization.id,
        text: `insert into organization_members (organization_id, user_id, role)
               values ($1, $2, 'admin')`,
        values: [organization.id, context.currentUser.id],
      });

      res.status(201).json({ ok: true, organization });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(401).json({ ok: false, organizations: [], error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown organizations error";
    console.error("api/organizations failed", {
      method: req.method,
      query: req.query,
      body: req.body,
      error,
    });
    res.status(200).json({ ok: false, organizations: [], error: message });
  }
}
