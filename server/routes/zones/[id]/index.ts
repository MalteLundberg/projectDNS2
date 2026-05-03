import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  queryWithRls,
  requireRequestContext,
  UnauthorizedError,
  type AuthenticatedRequestContext,
} from "../../../../lib/request-context.js";
import { deleteZone } from "../../../../lib/powerdns.js";
import { getSingleQueryValue, sendZoneError, type ZoneRow } from "../shared.js";

export const config = {
  runtime: "nodejs",
};

type ZoneDetailDeps = {
  requireRequestContext: typeof requireRequestContext;
  queryWithRls: typeof queryWithRls;
  deleteZone: typeof deleteZone;
};

async function loadZoneForContext(
  req: VercelRequest,
  context: AuthenticatedRequestContext,
  deps: ZoneDetailDeps,
) {
  const zoneId = String(getSingleQueryValue(req.query.id)).trim();

  if (!zoneId) {
    return null;
  }

  const zoneResult = await deps.queryWithRls({
    userId: context.currentUser.id,
    userEmail: context.currentUser.email,
    organizationId: context.activeOrganization?.id,
    text: `select id, organization_id as "organizationId", name,
                  powerdns_zone_id as "powerdnsZoneId"
           from dns_zones
           where id = $1
           limit 1`,
    values: [zoneId],
  });

  return (zoneResult.rows[0] ?? null) as ZoneRow | null;
}

export function buildZoneDetailHandler(deps: ZoneDetailDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    try {
      const context = await deps.requireRequestContext(req);
      const zone = await loadZoneForContext(req, context, deps);

      if (!zone) {
        res.status(404).json({ ok: false, error: "Zone not found" });
        return;
      }

      const membership = context.memberships.find(
        (item) => item.organizationId === zone.organizationId,
      );

      if (!membership) {
        res.status(403).json({ ok: false, error: "Access denied for zone" });
        return;
      }

      if (req.method === "DELETE") {
        if (membership.role !== "admin") {
          res.status(403).json({ ok: false, error: "Only organization admins can delete zones" });
          return;
        }

        await deps.deleteZone(zone.powerdnsZoneId);

        await deps.queryWithRls({
          userId: context.currentUser.id,
          userEmail: context.currentUser.email,
          organizationId: zone.organizationId,
          text: "delete from dns_zones where id = $1 and organization_id = $2 returning id",
          values: [zone.id, zone.organizationId],
        });

        res.status(200).json({
          ok: true,
          zone: {
            id: zone.id,
            organizationId: zone.organizationId,
            name: zone.name,
            powerdnsZoneId: zone.powerdnsZoneId,
          },
        });
        return;
      }

      res.status(405).json({ ok: false, error: "Method not allowed" });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        res.status(401).json({ ok: false, error: error.message });
        return;
      }

      console.error("api/zones/[id] failed", {
        method: req.method,
        query: req.query,
        body: req.body,
        error,
      });
      sendZoneError(res, error, "Unknown zone error");
    }
  };
}

export default buildZoneDetailHandler({
  requireRequestContext,
  queryWithRls,
  deleteZone,
});
