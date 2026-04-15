import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  queryWithRls,
  requireRequestContext,
  UnauthorizedError,
} from "../../lib/request-context.ts";

export const config = {
  runtime: "nodejs",
};

type PowerDnsZone = {
  id: string;
  name: string;
  kind?: string;
  url?: string;
};

type ZoneErrorCode =
  | "INVALID_JSON_BODY"
  | "INVALID_ZONE_NAME"
  | "POWERDNS_ENV_MISSING"
  | "POWERDNS_AUTH_FAILED"
  | "POWERDNS_UNREACHABLE"
  | "POWERDNS_REQUEST_FAILED"
  | "DNS_ZONE_SAVE_FAILED";

class ZoneApiError extends Error {
  code: ZoneErrorCode;
  details?: unknown;

  constructor(code: ZoneErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function getPowerDnsConfig() {
  const apiUrl = process.env.POWERDNS_API_URL;
  const apiKey = process.env.POWERDNS_API_KEY;
  const serverId = process.env.POWERDNS_SERVER_ID;

  if (!apiUrl) {
    throw new ZoneApiError("POWERDNS_ENV_MISSING", "POWERDNS_API_URL is not set");
  }

  if (!apiKey) {
    throw new ZoneApiError("POWERDNS_ENV_MISSING", "POWERDNS_API_KEY is not set");
  }

  if (!serverId) {
    throw new ZoneApiError("POWERDNS_ENV_MISSING", "POWERDNS_SERVER_ID is not set");
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ""),
    apiKey,
    serverId,
  };
}

async function powerDnsRequest(path: string, init?: RequestInit) {
  const config = getPowerDnsConfig();
  let response: Response;

  try {
    response = await fetch(`${config.apiUrl}/servers/${config.serverId}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new ZoneApiError("POWERDNS_UNREACHABLE", "PowerDNS API is not reachable", {
      cause: error instanceof Error ? error.message : String(error),
      url: `${config.apiUrl}/servers/${config.serverId}${path}`,
    });
  }

  const responseText = await response.text();
  let data: { error?: string } | PowerDnsZone | PowerDnsZone[] | null = null;

  if (responseText) {
    try {
      data = JSON.parse(responseText) as { error?: string } | PowerDnsZone | PowerDnsZone[];
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ZoneApiError("POWERDNS_AUTH_FAILED", "PowerDNS authentication failed", {
        status: response.status,
        responseText,
      });
    }

    throw new ZoneApiError(
      "POWERDNS_REQUEST_FAILED",
      typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : `PowerDNS request failed with status ${response.status}`,
      {
        status: response.status,
        responseText,
      },
    );
  }

  return data;
}

function normalizePowerDnsZoneName(name: string) {
  const trimmed = name.trim().toLowerCase();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

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

async function createZone(name: string): Promise<PowerDnsZone> {
  const normalizedName = normalizePowerDnsZoneName(name);

  return (await powerDnsRequest("/zones", {
    method: "POST",
    body: JSON.stringify({
      name: normalizedName,
      kind: "Native",
      nameservers: [],
    }),
  })) as PowerDnsZone;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const context = await requireRequestContext(req);

    const activeOrganization = context.activeOrganization;

    if (!activeOrganization?.id) {
      res.status(200).json({ ok: true, zones: [] });
      return;
    }

    if (req.method === "GET") {
      const result = await queryWithRls({
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
      const existingZoneResult = await queryWithRls({
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
        providerZone = await createZone(normalizedName);
      } catch (providerError) {
        const providerMessage =
          providerError instanceof Error ? providerError.message : "Unknown PowerDNS error";
        const providerCode =
          providerError instanceof ZoneApiError ? providerError.code : "POWERDNS_REQUEST_FAILED";
        const providerDetails =
          providerError instanceof ZoneApiError ? providerError.details : undefined;

        console.error("api/zones create zone in PowerDNS failed", {
          organizationId: activeOrganization.id,
          name: normalizedName,
          error: providerError,
        });

        res.status(200).json({
          ok: false,
          error: providerMessage,
          code: providerCode,
          provider: "powerdns",
          details: providerDetails,
        });
        return;
      }

      try {
        const zoneResult = await queryWithRls({
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
        const databaseMessage =
          databaseError instanceof Error
            ? databaseError.message
            : "Unknown dns_zones database error";

        console.error("api/zones save zone ownership failed", {
          organizationId: activeOrganization.id,
          name: normalizedName,
          providerZone,
          error: databaseError,
        });

        res.status(200).json({
          ok: false,
          error: databaseMessage,
          code: "DNS_ZONE_SAVE_FAILED",
          provider: {
            name: "powerdns",
            zoneId: providerZone.id ?? providerZone.name ?? normalizedName,
          },
        });
        return;
      }
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(401).json({ ok: false, zones: [], error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown zones error";
    const code = error instanceof ZoneApiError ? error.code : undefined;
    const details = error instanceof ZoneApiError ? error.details : undefined;
    console.error("api/zones failed", {
      method: req.method,
      query: req.query,
      body: req.body,
      error,
    });
    res.status(200).json({ ok: false, zones: [], error: message, code, details });
  }
}
