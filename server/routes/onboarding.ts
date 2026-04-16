import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import {
  requireRequestContext,
  UnauthorizedError,
  withRlsContext,
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
      const existing = await withRlsContext(
        {
          userId: context.currentUser.id,
          userEmail: context.currentUser.email,
        },
        (client) => client.query("select id from organizations where slug = $1 limit 1", [slug]),
      );

      if (existing.rowCount === 0) {
        break;
      }

      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const organization = await withRlsContext(
      {
        userId: context.currentUser.id,
        userEmail: context.currentUser.email,
      },
      async (client) => {
        const organizationId = randomUUID();

        await client.query(
          `insert into organizations (id, name, slug, created_by_user_id)
           values ($1, $2, $3, $4)`,
          [organizationId, normalizedName, slug, context.currentUser.id],
        );

        await client.query("select set_config('app.current_organization_id', $1, true)", [
          organizationId,
        ]);
        await client.query(
          `insert into organization_members (organization_id, user_id, role)
           values ($1, $2, 'admin')`,
          [organizationId, context.currentUser.id],
        );

        const organizationResult = await client.query(
          `select id, name, slug, created_by_user_id as "createdByUserId", created_at as "createdAt"
           from organizations
           where id = $1
           limit 1`,
          [organizationId],
        );

        const createdOrganization = organizationResult.rows[0];

        if (!createdOrganization) {
          throw new Error(
            "Organization was created but could not be loaded after membership insert",
          );
        }

        return createdOrganization;
      },
    );

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
    res.status(500).json({ ok: false, error: message });
  }
}
