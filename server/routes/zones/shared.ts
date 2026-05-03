import type { VercelResponse } from "@vercel/node";
import { ZoneApiError, type ZoneErrorCode } from "../../../lib/powerdns.js";

export type ZoneRow = {
  id: string;
  organizationId: string;
  name: string;
  powerdnsZoneId: string;
};

export function getSingleQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function getZoneErrorStatus(code: ZoneErrorCode) {
  switch (code) {
    case "INVALID_JSON_BODY":
    case "INVALID_ZONE_NAME":
    case "INVALID_RECORD_NAME":
    case "INVALID_RECORD_TYPE":
    case "INVALID_RECORD_CONTENT":
    case "INVALID_RECORD_TTL":
      return 400;
    case "POWERDNS_AUTH_FAILED":
      return 502;
    case "POWERDNS_UNREACHABLE":
      return 503;
    case "POWERDNS_REQUEST_FAILED":
      return 502;
    case "POWERDNS_ZONE_DELETE_FAILED":
    case "DNS_ZONE_SAVE_FAILED":
      return 500;
    default:
      return 500;
  }
}

export function sendZoneError(
  res: VercelResponse,
  error: unknown,
  fallbackMessage: string,
  extra: Record<string, unknown> = {},
) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const code = error instanceof ZoneApiError ? error.code : undefined;
  const details = error instanceof ZoneApiError ? error.details : undefined;
  const status = code ? getZoneErrorStatus(code) : 500;

  res.status(status).json({ ok: false, error: message, code, details, ...extra });
}
