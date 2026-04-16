import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createLogoutCookies, deleteSession } from "../../lib/auth.js";
import { getRequestContext } from "../../lib/request-context.js";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const context = await getRequestContext(req);

    if (context.sessionToken) {
      await deleteSession(context.sessionToken);
    }

    res.setHeader("Set-Cookie", createLogoutCookies());
    res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown logout error";
    console.error("api/auth/logout failed", {
      method: req.method,
      error,
    });
    res.status(200).json({ ok: false, error: message });
  }
}
