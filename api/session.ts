import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createActiveOrganizationCookie,
  createSessionCookie,
  getRequestContext,
} from "../lib/request-context.js";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const context = await getRequestContext(req);
    const setCookie: string[] = [];

    if (context.sessionToken) {
      setCookie.push(createSessionCookie("app_session", context.sessionToken, 60 * 60 * 24 * 30));
    }

    if (context.activeOrganization?.id) {
      setCookie.push(
        createActiveOrganizationCookie(context.activeOrganization.id, 60 * 60 * 24 * 30),
      );
    }

    if (setCookie.length > 0) {
      res.setHeader("Set-Cookie", setCookie);
    }

    res.status(200).json({
      ok: true,
      currentUser: context.currentUser,
      memberships: context.memberships,
      activeOrganization: context.activeOrganization,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown session error";
    console.error("api/session failed", {
      method: req.method,
      error,
    });
    res.status(200).json({
      ok: false,
      error: message,
      currentUser: null,
      memberships: [],
      activeOrganization: null,
    });
  }
}
