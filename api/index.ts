import type { VercelRequest, VercelResponse } from "@vercel/node";
import authLoginHandler from "../server/routes/auth/login.js";
import authLogoutHandler from "../server/routes/auth/logout.js";
import authVerifyHandler from "../server/routes/auth/verify.js";
import dbCheckHandler from "../server/routes/db-check.js";
import healthHandler from "../server/routes/health.js";
import acceptInvitationHandler from "../server/routes/invitations/[id]/accept.js";
import revokeInvitationHandler from "../server/routes/invitations/[id]/revoke.js";
import invitationsHandler from "../server/routes/invitations/index.js";
import onboardingHandler from "../server/routes/onboarding.js";
import organizationMembersHandler from "../server/routes/organizations/[id]/members.js";
import organizationsHandler from "../server/routes/organizations/index.js";
import sessionHandler from "../server/routes/session.js";
import activeOrganizationHandler from "../server/routes/session/active-organization.js";
import zoneRecordsHandler from "../server/routes/zones/[id]/records.js";
import zonesHandler from "../server/routes/zones/index.js";

export const config = {
  runtime: "nodejs",
};

type Handler = (req: VercelRequest, res: VercelResponse) => void | Promise<void>;

function cloneRequest(req: VercelRequest, overrides: Partial<VercelRequest>): VercelRequest {
  return Object.assign(Object.create(Object.getPrototypeOf(req)), req, overrides);
}

function routeWithId(req: VercelRequest, id: string) {
  return cloneRequest(req, {
    query: {
      ...req.query,
      id,
    },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const pathname = new URL(req.url ?? "/api", "http://localhost").pathname;

  const exactRoutes: Record<string, Handler> = {
    "/api/health": healthHandler,
    "/api/db-check": dbCheckHandler,
    "/api/session": sessionHandler,
    "/api/session/active-organization": activeOrganizationHandler,
    "/api/organizations": organizationsHandler,
    "/api/invitations": invitationsHandler,
    "/api/zones": zonesHandler,
    "/api/auth/login": authLoginHandler,
    "/api/auth/logout": authLogoutHandler,
    "/api/auth/verify": authVerifyHandler,
    "/api/onboarding": onboardingHandler,
  };

  const exactHandler = exactRoutes[pathname];

  if (exactHandler) {
    await exactHandler(req, res);
    return;
  }

  const organizationMembersMatch = pathname.match(/^\/api\/organizations\/([^/]+)\/members$/);

  if (organizationMembersMatch) {
    await organizationMembersHandler(routeWithId(req, organizationMembersMatch[1]), res);
    return;
  }

  const revokeInvitationMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/revoke$/);

  if (revokeInvitationMatch) {
    await revokeInvitationHandler(routeWithId(req, revokeInvitationMatch[1]), res);
    return;
  }

  const acceptInvitationMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/accept$/);

  if (acceptInvitationMatch) {
    await acceptInvitationHandler(routeWithId(req, acceptInvitationMatch[1]), res);
    return;
  }

  const zoneRecordsMatch = pathname.match(/^\/api\/zones\/([^/]+)\/records$/);

  if (zoneRecordsMatch) {
    await zoneRecordsHandler(routeWithId(req, zoneRecordsMatch[1]), res);
    return;
  }

  res.status(404).json({ ok: false, error: "Not found" });
}
