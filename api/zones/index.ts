import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Pool, type PoolClient } from 'pg'

export const config = {
  runtime: 'nodejs',
}

let pool: Pool | undefined
const FALLBACK_USER_EMAIL = 'test@example.com'
const FALLBACK_SESSION_TOKEN = 'dev-test-session-token'

type PowerDnsZone = {
  id: string
  name: string
  kind?: string
  url?: string
}

type ZoneErrorCode =
  | 'INVALID_JSON_BODY'
  | 'INVALID_ZONE_NAME'
  | 'POWERDNS_ENV_MISSING'
  | 'POWERDNS_AUTH_FAILED'
  | 'POWERDNS_UNREACHABLE'
  | 'POWERDNS_REQUEST_FAILED'
  | 'DNS_ZONE_SAVE_FAILED'

class ZoneApiError extends Error {
  code: ZoneErrorCode
  details?: unknown

  constructor(code: ZoneErrorCode, message: string, details?: unknown) {
    super(message)
    this.code = code
    this.details = details
  }
}

function getPool() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  pool ??= new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  })

  return pool
}

function parseCookies(headerValue: string | undefined) {
  const pairs = (headerValue ?? '').split(';').map((part) => part.trim()).filter(Boolean)

  return Object.fromEntries(
    pairs.map((pair) => {
      const separatorIndex = pair.indexOf('=')

      if (separatorIndex === -1) {
        return [pair, '']
      }

      return [pair.slice(0, separatorIndex), decodeURIComponent(pair.slice(separatorIndex + 1))]
    }),
  )
}

function getPowerDnsConfig() {
  const apiUrl = process.env.POWERDNS_API_URL
  const apiKey = process.env.POWERDNS_API_KEY
  const serverId = process.env.POWERDNS_SERVER_ID

  if (!apiUrl) {
    throw new ZoneApiError('POWERDNS_ENV_MISSING', 'POWERDNS_API_URL is not set')
  }

  if (!apiKey) {
    throw new ZoneApiError('POWERDNS_ENV_MISSING', 'POWERDNS_API_KEY is not set')
  }

  if (!serverId) {
    throw new ZoneApiError('POWERDNS_ENV_MISSING', 'POWERDNS_SERVER_ID is not set')
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ''),
    apiKey,
    serverId,
  }
}

async function powerDnsRequest(path: string, init?: RequestInit) {
  const config = getPowerDnsConfig()
  let response: Response

  try {
    response = await fetch(`${config.apiUrl}/servers/${config.serverId}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    throw new ZoneApiError('POWERDNS_UNREACHABLE', 'PowerDNS API is not reachable', {
      cause: error instanceof Error ? error.message : String(error),
      url: `${config.apiUrl}/servers/${config.serverId}${path}`,
    })
  }

  const responseText = await response.text()
  let data: { error?: string } | PowerDnsZone | PowerDnsZone[] | null = null

  if (responseText) {
    try {
      data = JSON.parse(responseText) as { error?: string } | PowerDnsZone | PowerDnsZone[]
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ZoneApiError('POWERDNS_AUTH_FAILED', 'PowerDNS authentication failed', {
        status: response.status,
        responseText,
      })
    }

    throw new ZoneApiError(
      'POWERDNS_REQUEST_FAILED',
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `PowerDNS request failed with status ${response.status}`,
      {
        status: response.status,
        responseText,
      },
    )
  }

  return data
}

function normalizePowerDnsZoneName(name: string) {
  const trimmed = name.trim().toLowerCase()
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`
}

function parseZoneCreateBody(body: unknown) {
  if (!body || typeof body !== 'object') {
    throw new ZoneApiError('INVALID_JSON_BODY', 'Request body must be a JSON object')
  }

  const candidate = 'name' in body ? body.name : undefined

  if (typeof candidate !== 'string') {
    throw new ZoneApiError('INVALID_ZONE_NAME', 'name must be a string')
  }

  const trimmedName = candidate.trim()

  if (!trimmedName) {
    throw new ZoneApiError('INVALID_ZONE_NAME', 'name is required')
  }

  return {
    name: normalizePowerDnsZoneName(trimmedName),
  }
}

async function createZone(name: string): Promise<PowerDnsZone> {
  const normalizedName = normalizePowerDnsZoneName(name)

  return (await powerDnsRequest('/zones', {
    method: 'POST',
    body: JSON.stringify({
      name: normalizedName,
      kind: 'Native',
      nameservers: [],
    }),
  })) as PowerDnsZone
}

async function getRequestContext(req: VercelRequest) {
  const cookies = parseCookies(req.headers.cookie)
  const sessionToken = cookies.app_session || FALLBACK_SESSION_TOKEN
  const client = await getPool().connect()

  try {
    const currentUserResult = await client.query(
      `select u.id, u.email, u.name
       from user_sessions us
       inner join users u on u.id = us.user_id
       where us.session_token = $1 and us.expires_at > now()
       limit 1`,
      [sessionToken],
    )
    const currentUser =
      currentUserResult.rows[0] ??
      (
        await client.query('select id, email, name from users where email = $1 limit 1', [
          FALLBACK_USER_EMAIL,
        ])
      ).rows[0]

    if (!currentUser) {
      return { currentUser: null, memberships: [], activeOrganization: null }
    }

    await client.query('begin')
    await client.query("select set_config('app.current_user_id', $1, true)", [currentUser.id])

    const membershipsResult = await client.query(
      `select om.organization_id as "organizationId", om.role,
              o.name as "organizationName", o.slug as "organizationSlug"
       from organization_members om
       inner join organizations o on o.id = om.organization_id
       where om.user_id = $1
       order by o.created_at asc`,
      [currentUser.id],
    )

    await client.query('commit')

    const memberships = membershipsResult.rows
    const requestedOrganizationId = String(cookies.active_organization_id ?? '').trim()
    const activeOrganization =
      memberships.find((membership) => membership.organizationId === requestedOrganizationId) ??
      memberships[0] ??
      null

    return { currentUser, memberships, activeOrganization }
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // Ignore rollback errors when no transaction is active.
    }

    throw error
  } finally {
    client.release()
  }
}

async function withRlsContext<T>(
  userId: string,
  organizationId: string | null,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await getPool().connect()

  try {
    await client.query('begin')
    await client.query("select set_config('app.current_user_id', $1, true)", [userId])
    await client.query("select set_config('app.current_organization_id', $1, true)", [organizationId ?? ''])
    const result = await callback(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const context = await getRequestContext(req)

    if (!context.currentUser?.id) {
      res.status(200).json({ ok: false, zones: [], error: 'Current user could not be resolved' })
      return
    }

    const activeOrganization = context.activeOrganization

    if (!activeOrganization?.id) {
      res.status(200).json({ ok: true, zones: [] })
      return
    }

    if (req.method === 'GET') {
      const result = await withRlsContext(context.currentUser.id, activeOrganization.id, (client) =>
        client.query(
          `select id, organization_id as "organizationId", name, provider,
                  powerdns_zone_id as "powerdnsZoneId", created_by_user_id as "createdByUserId",
                  created_at as "createdAt"
           from dns_zones
           where organization_id = $1
           order by created_at asc`,
          [activeOrganization.id],
        ),
      )

      res.status(200).json({ ok: true, zones: result.rows })
      return
    }

    if (req.method === 'POST') {
      const parsedBody = parseZoneCreateBody(req.body)

      const activeMembership = context.memberships.find(
        (membership) => membership.organizationId === activeOrganization.id,
      )

      if (!activeMembership || activeMembership.role !== 'admin') {
        res.status(403).json({ ok: false, error: 'Only organization admins can create zones' })
        return
      }

      const normalizedName = parsedBody.name
      const existingZoneResult = await withRlsContext(context.currentUser.id, activeOrganization.id, (client) =>
        client.query('select id from dns_zones where organization_id = $1 and name = $2 limit 1', [
          activeOrganization.id,
          normalizedName,
        ]),
      )

      if (existingZoneResult.rowCount !== 0) {
        res.status(409).json({ ok: false, error: 'Zone already exists for this organization' })
        return
      }

      let providerZone

      try {
        providerZone = await createZone(normalizedName)
      } catch (providerError) {
        const providerMessage = providerError instanceof Error ? providerError.message : 'Unknown PowerDNS error'
        const providerCode = providerError instanceof ZoneApiError ? providerError.code : 'POWERDNS_REQUEST_FAILED'
        const providerDetails = providerError instanceof ZoneApiError ? providerError.details : undefined

        console.error('api/zones create zone in PowerDNS failed', {
          organizationId: activeOrganization.id,
          name: normalizedName,
          error: providerError,
        })

        res.status(200).json({
          ok: false,
          error: providerMessage,
          code: providerCode,
          provider: 'powerdns',
          details: providerDetails,
        })
        return
      }

      try {
        const zoneResult = await withRlsContext(context.currentUser.id, activeOrganization.id, (client) =>
          client.query(
            `insert into dns_zones (
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
            [
              activeOrganization.id,
              normalizedName,
              providerZone.id ?? providerZone.name ?? normalizedName,
              context.currentUser.id,
            ],
          ),
        )

        res.status(201).json({
          ok: true,
          zone: zoneResult.rows[0],
          provider: {
            name: 'powerdns',
            zoneId: providerZone.id ?? providerZone.name ?? normalizedName,
          },
        })
        return
      } catch (databaseError) {
        const databaseMessage =
          databaseError instanceof Error ? databaseError.message : 'Unknown dns_zones database error'

        console.error('api/zones save zone ownership failed', {
          organizationId: activeOrganization.id,
          name: normalizedName,
          providerZone,
          error: databaseError,
        })

        res.status(200).json({
          ok: false,
          error: databaseMessage,
          code: 'DNS_ZONE_SAVE_FAILED',
          provider: {
            name: 'powerdns',
            zoneId: providerZone.id ?? providerZone.name ?? normalizedName,
          },
        })
        return
      }
    }

    res.status(405).json({ ok: false, error: 'Method not allowed' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown zones error'
    const code = error instanceof ZoneApiError ? error.code : undefined
    const details = error instanceof ZoneApiError ? error.details : undefined
    console.error('api/zones failed', {
      method: req.method,
      query: req.query,
      body: req.body,
      error,
    })
    res.status(200).json({ ok: false, zones: [], error: message, code, details })
  }
}
