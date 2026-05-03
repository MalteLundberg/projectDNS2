type PowerDnsRecord = {
  content: string;
  disabled?: boolean;
};

export type PowerDnsRrset = {
  name: string;
  type: string;
  ttl?: number;
  changetype?: "REPLACE" | "DELETE";
  records?: PowerDnsRecord[];
};

export type PowerDnsZone = {
  id: string;
  name: string;
  kind?: string;
  url?: string;
  rrsets?: PowerDnsRrset[];
};

export type ZoneErrorCode =
  | "INVALID_JSON_BODY"
  | "INVALID_ZONE_NAME"
  | "INVALID_RECORD_NAME"
  | "INVALID_RECORD_TYPE"
  | "INVALID_RECORD_CONTENT"
  | "INVALID_RECORD_TTL"
  | "POWERDNS_ENV_MISSING"
  | "POWERDNS_AUTH_FAILED"
  | "POWERDNS_UNREACHABLE"
  | "POWERDNS_REQUEST_FAILED"
  | "POWERDNS_ZONE_DELETE_FAILED"
  | "DNS_ZONE_SAVE_FAILED";

export class ZoneApiError extends Error {
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

export async function powerDnsRequest(path: string, init?: RequestInit) {
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

export function normalizePowerDnsZoneName(name: string) {
  const trimmed = name.trim().toLowerCase();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

export function normalizeRecordName(name: string, zoneName: string) {
  const trimmed = name.trim().toLowerCase();

  if (!trimmed) {
    throw new ZoneApiError("INVALID_RECORD_NAME", "Record name is required");
  }

  if (trimmed === "@") {
    return normalizePowerDnsZoneName(zoneName);
  }

  if (trimmed.endsWith(".")) {
    return trimmed;
  }

  return `${trimmed}.${normalizePowerDnsZoneName(zoneName)}`;
}

export async function createZone(name: string): Promise<PowerDnsZone> {
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

export async function getZone(zoneId: string): Promise<PowerDnsZone> {
  return (await powerDnsRequest(`/zones/${encodeURIComponent(zoneId)}`)) as PowerDnsZone;
}

export async function patchZoneRecords(zoneId: string, rrsets: PowerDnsRrset[]) {
  return powerDnsRequest(`/zones/${encodeURIComponent(zoneId)}`, {
    method: "PATCH",
    body: JSON.stringify({ rrsets }),
  });
}

export async function deleteZone(zoneId: string) {
  try {
    return await powerDnsRequest(`/zones/${encodeURIComponent(zoneId)}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (error instanceof ZoneApiError) {
      throw new ZoneApiError("POWERDNS_ZONE_DELETE_FAILED", error.message, error.details);
    }

    throw error;
  }
}
