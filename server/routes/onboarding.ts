import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  queryWithRls,
  requireRequestContext,
  UnauthorizedError,
} from "../../lib/request-context.js";

export const config = {
  runtime: "nodejs",
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const context = await requireRequestContext(req);

    if (context.memberships.length > 0) {
      res
        .status(409)
        .json({ ok: false, error: "Onboarding is only for users without an organization" });
      return;
    }

    const { organizationName } = req.body ?? {};
    const normalizedName = String(organizationName ?? "").trim();

    if (!normalizedName) {
      res.status(400).json({ ok: false, error: "organizationName is required" });
      return;
    }

    const baseSlug = slugify(normalizedName) || "organization";
    let slug = baseSlug;
    let suffix = 1;

    while (true) {
      const existing = await queryWithRls({
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
        text: "select id from organizations where slug = $1 limit 1",
        values: [slug],
      });

      if (existing.rowCount === 0) {
        break;
      }

      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const organizationResult = await queryWithRls({
      userId: context.currentUser.id,
      userEmail: context.currentUser.email,
      text: `insert into organizations (name, slug, created_by_user_id)
             values ($1, $2, $3)
             returning id, name, slug, created_by_user_id as "createdByUserId", created_at as "createdAt"`,
      values: [normalizedName, slug, context.currentUser.id],
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
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(401).json({ ok: false, error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown onboarding error";
    console.error("api/onboarding failed", {
      method: req.method,
      body: req.body,
      error,
    });
    res.status(200).json({ ok: false, error: message });
  }
}
