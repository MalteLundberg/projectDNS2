import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  queryWithRls,
  requireRequestContext,
  UnauthorizedError,
} from "../../../../lib/request-context.js";
import {
  getZone,
  normalizeRecordName,
  patchZoneRecords,
  type PowerDnsRrset,
  ZoneApiError,
} from "../../../../lib/powerdns.js";

export const config = {
  runtime: "nodejs",
};

type ZoneRow = {
  id: string;
  organizationId: string;
  name: string;
  powerdnsZoneId: string;
};

function getSingleQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function sanitizeRrsets(rrsets: PowerDnsRrset[] | undefined) {
  return (rrsets ?? [])
    .filter((rrset) => rrset.type !== "SOA")
    .filter((rrset) => (rrset.records?.length ?? 0) > 0)
    .map((rrset) => ({
      name: rrset.name,
      type: rrset.type,
      ttl: rrset.ttl ?? 3600,
      records: (rrset.records ?? []).map((record) => ({
        content: record.content,
        disabled: Boolean(record.disabled),
      })),
    }));
}

function parseRecordBody(body: unknown, zoneName: string) {
  if (!body || typeof body !== "object") {
    throw new ZoneApiError("INVALID_JSON_BODY", "Request body must be a JSON object");
  }

  const name = "name" in body && typeof body.name === "string" ? body.name : "";
  const type =
    "type" in body && typeof body.type === "string" ? body.type.trim().toUpperCase() : "";
  const content = "content" in body && typeof body.content === "string" ? body.content.trim() : "";
  const ttlValue = "ttl" in body ? Number(body.ttl) : 3600;

  if (!type) {
    throw new ZoneApiError("INVALID_RECORD_TYPE", "Record type is required");
  }

  if (!/^[A-Z0-9]+$/.test(type)) {
    throw new ZoneApiError("INVALID_RECORD_TYPE", "Record type is invalid");
  }

  if (!content) {
    throw new ZoneApiError("INVALID_RECORD_CONTENT", "Record content is required");
  }

  if (!Number.isFinite(ttlValue) || ttlValue <= 0) {
    throw new ZoneApiError("INVALID_RECORD_TTL", "TTL must be a positive number");
  }

  return {
    name: normalizeRecordName(name, zoneName),
    type,
    ttl: Math.round(ttlValue),
    content,
  };
}

async function loadZoneForContext(req: VercelRequest) {
  const context = await requireRequestContext(req);
  const zoneId = String(getSingleQueryValue(req.query.id)).trim();

  if (!zoneId) {
    return { context, zone: null as ZoneRow | null };
  }

  const zoneResult = await queryWithRls({
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

  return {
    context,
    zone: (zoneResult.rows[0] ?? null) as ZoneRow | null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { context, zone } = await loadZoneForContext(req);

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

    if (req.method === "GET") {
      const providerZone = await getZone(zone.powerdnsZoneId);
      res.status(200).json({
        ok: true,
        zone: {
          id: zone.id,
          name: zone.name,
          powerdnsZoneId: zone.powerdnsZoneId,
        },
        rrsets: sanitizeRrsets(providerZone.rrsets),
      });
      return;
    }

    if (membership.role !== "admin") {
      res.status(403).json({ ok: false, error: "Only organization admins can manage records" });
      return;
    }

    if (req.method === "POST") {
      const record = parseRecordBody(req.body, zone.name);
      const providerZone = await getZone(zone.powerdnsZoneId);
      const rrsets = sanitizeRrsets(providerZone.rrsets);
      const existing = rrsets.find(
        (rrset) => rrset.name === record.name && rrset.type === record.type,
      );
      const nextRecords = [
        ...(existing?.records ?? []),
        {
          content: record.content,
          disabled: false,
        },
      ];

      await patchZoneRecords(zone.powerdnsZoneId, [
        {
          name: record.name,
          type: record.type,
          ttl: record.ttl,
          changetype: "REPLACE",
          records: nextRecords,
        },
      ]);

      const refreshedZone = await getZone(zone.powerdnsZoneId);
      res.status(201).json({ ok: true, rrsets: sanitizeRrsets(refreshedZone.rrsets) });
      return;
    }

    if (req.method === "DELETE") {
      const name = String(getSingleQueryValue(req.query.name)).trim();
      const type = String(getSingleQueryValue(req.query.type)).trim().toUpperCase();
      const content = String(getSingleQueryValue(req.query.content)).trim();

      if (!name || !type || !content) {
        res.status(400).json({ ok: false, error: "name, type and content are required" });
        return;
      }

      const recordName = normalizeRecordName(name, zone.name);
      const providerZone = await getZone(zone.powerdnsZoneId);
      const rrsets = sanitizeRrsets(providerZone.rrsets);
      const existing = rrsets.find((rrset) => rrset.name === recordName && rrset.type === type);

      if (!existing) {
        res.status(404).json({ ok: false, error: "Record set not found" });
        return;
      }

      const remainingRecords = (existing.records ?? []).filter(
        (record) => record.content !== content,
      );

      await patchZoneRecords(zone.powerdnsZoneId, [
        remainingRecords.length > 0
          ? {
              name: recordName,
              type,
              ttl: existing.ttl ?? 3600,
              changetype: "REPLACE",
              records: remainingRecords,
            }
          : {
              name: recordName,
              type,
              changetype: "DELETE",
              records: [],
            },
      ]);

      const refreshedZone = await getZone(zone.powerdnsZoneId);
      res.status(200).json({ ok: true, rrsets: sanitizeRrsets(refreshedZone.rrsets) });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(401).json({ ok: false, rrsets: [], error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown records error";
    const code = error instanceof ZoneApiError ? error.code : undefined;
    const details = error instanceof ZoneApiError ? error.details : undefined;
    console.error("api/zones/[id]/records failed", {
      method: req.method,
      query: req.query,
      body: req.body,
      error,
    });
    res.status(200).json({ ok: false, rrsets: [], error: message, code, details });
  }
}
