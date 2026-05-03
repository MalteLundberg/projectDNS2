import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  queryWithRls,
  requireRequestContext,
  UnauthorizedError,
} from "../../../lib/request-context.js";
import { createZone, normalizePowerDnsZoneName, ZoneApiError } from "../../../lib/powerdns.js";
import { sendZoneError } from "./shared.js";

export const config = {
  runtime: "nodejs",
};

type ZonesDeps = {
  requireRequestContext: typeof requireRequestContext;
  queryWithRls: typeof queryWithRls;
  createZone: typeof createZone;
};

function parseZoneCreateBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new ZoneApiError("INVALID_JSON_BODY", "Request body must be a JSON object");
  }

  const candidate = "name" in body ? body.name : undefined;

  if (typeof candidate !== "string") {
    throw new ZoneApiError("INVALID_ZONE_NAME", "name must be a string");
  }

  const trimmedName = candidate.trim();

  if (!trimmedName) {
    throw new ZoneApiError("INVALID_ZONE_NAME", "name is required");
  }

  return {
    name: normalizePowerDnsZoneName(trimmedName),
  };
}

export function buildZonesHandler(deps: ZonesDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    try {
      const context = await deps.requireRequestContext(req);

      const activeOrganization = context.activeOrganization;

      if (!activeOrganization?.id) {
        res.status(200).json({ ok: true, zones: [] });
        return;
      }

      if (req.method === "GET") {
        const result = await deps.queryWithRls({
          userId: context.currentUser.id,
          userEmail: context.currentUser.email,
          organizationId: activeOrganization.id,
          text: `select id, organization_id as "organizationId", name, provider,
                      powerdns_zone_id as "powerdnsZoneId", created_by_user_id as "createdByUserId",
                      created_at as "createdAt"
               from dns_zones
               where organization_id = $1
               order by created_at asc`,
          values: [activeOrganization.id],
        });

        res.status(200).json({ ok: true, zones: result.rows });
        return;
      }

      if (req.method === "POST") {
        const parsedBody = parseZoneCreateBody(req.body);

        const activeMembership = context.memberships.find(
          (membership) => membership.organizationId === activeOrganization.id,
        );

        if (!activeMembership || activeMembership.role !== "admin") {
          res.status(403).json({ ok: false, error: "Only organization admins can create zones" });
          return;
        }

        const normalizedName = parsedBody.name;
        const existingZoneResult = await deps.queryWithRls({
          userId: context.currentUser.id,
          userEmail: context.currentUser.email,
          organizationId: activeOrganization.id,
          text: "select id from dns_zones where organization_id = $1 and name = $2 limit 1",
          values: [activeOrganization.id, normalizedName],
        });

        if (existingZoneResult.rowCount !== 0) {
          res.status(409).json({ ok: false, error: "Zone already exists for this organization" });
          return;
        }

        let providerZone;

        try {
          providerZone = await deps.createZone(normalizedName);
        } catch (providerError) {
          console.error("api/zones create zone in PowerDNS failed", {
            organizationId: activeOrganization.id,
            name: normalizedName,
            error: providerError,
          });

          sendZoneError(res, providerError, "Unknown PowerDNS error", { provider: "powerdns" });
          return;
        }

        try {
          const zoneResult = await deps.queryWithRls({
            userId: context.currentUser.id,
            userEmail: context.currentUser.email,
            organizationId: activeOrganization.id,
            text: `insert into dns_zones (
                    organization_id,
                    name,
                    provider,
                   powerdns_zone_id,
                   created_by_user_id
                 )
                 values ($1, $2, 'powerdns', $3, $4)
                 returning id, organization_id as "organizationId", name, provider,
                           powerdns_zone_id as "powerdnsZoneId", created_by_user_id as "createdByUserId",
                           created_at as "createdAt"`,
            values: [
              activeOrganization.id,
              normalizedName,
              providerZone.id ?? providerZone.name ?? normalizedName,
              context.currentUser.id,
            ],
          });

          res.status(201).json({
            ok: true,
            zone: zoneResult.rows[0],
            provider: {
              name: "powerdns",
              zoneId: providerZone.id ?? providerZone.name ?? normalizedName,
            },
          });
          return;
        } catch (databaseError) {
          console.error("api/zones save zone ownership failed", {
            organizationId: activeOrganization.id,
            name: normalizedName,
            providerZone,
            error: databaseError,
          });

          sendZoneError(
            res,
            new ZoneApiError(
              "DNS_ZONE_SAVE_FAILED",
              databaseError instanceof Error ? databaseError.message : "Unknown dns_zones database error",
            ),
            "Unknown dns_zones database error",
            {
              provider: {
                name: "powerdns",
                zoneId: providerZone.id ?? providerZone.name ?? normalizedName,
              },
            },
          );
          return;
        }
      }

      res.status(405).json({ ok: false, error: "Method not allowed" });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        res.status(401).json({ ok: false, zones: [], error: error.message });
        return;
      }

      console.error("api/zones failed", {
        method: req.method,
        query: req.query,
        body: req.body,
        error,
      });
      sendZoneError(res, error, "Unknown zones error", { zones: [] });
    }
  };
}

export default buildZonesHandler({
  requireRequestContext,
  queryWithRls,
  createZone,
});
