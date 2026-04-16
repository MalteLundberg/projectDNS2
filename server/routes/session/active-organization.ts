import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createActiveOrganizationCookie,
  requireRequestContext,
} from "../../../lib/request-context.js";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const { organizationId } = req.body ?? {};

    if (!organizationId) {
      res.status(400).json({ ok: false, error: "organizationId is required" });
      return;
    }

    const context = await requireRequestContext(req);
    const membership = context.memberships.find(
      (item) => item.organizationId === String(organizationId).trim(),
    );

    if (!membership) {
      res.status(200).json({ ok: false, error: "Organization is not available for current user" });
      return;
    }

    res.setHeader(
      "Set-Cookie",
      createActiveOrganizationCookie(membership.organizationId, 60 * 60 * 24 * 30),
    );
    res.status(200).json({
      ok: true,
      activeOrganization: {
        id: membership.organizationId,
        name: membership.organizationName,
        slug: membership.organizationSlug,
        role: membership.role,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown active organization error";
    console.error("api/session/active-organization failed", {
      method: req.method,
      body: req.body,
      error,
    });
    res.status(200).json({ ok: false, error: message });
  }
}
