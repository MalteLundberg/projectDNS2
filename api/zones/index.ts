import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Pool, type PoolClient } from 'pg'
import { createZone, normalizePowerDnsZoneName } from '../../lib/powerdns.ts'

export const config = {
  runtime: 'nodejs',
}

let pool: Pool | undefined
const FALLBACK_USER_EMAIL = 'test@example.com'
const FALLBACK_SESSION_TOKEN = 'dev-test-session-token'

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
      const { name } = req.body ?? {}

      if (!name) {
        res.status(400).json({ ok: false, error: 'name is required' })
        return
      }

      const activeMembership = context.memberships.find(
        (membership) => membership.organizationId === activeOrganization.id,
      )

      if (!activeMembership || activeMembership.role !== 'admin') {
        res.status(403).json({ ok: false, error: 'Only organization admins can create zones' })
        return
      }

      const normalizedName = normalizePowerDnsZoneName(String(name))
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
        const providerMessage =
          providerError instanceof Error ? providerError.message : 'Unknown PowerDNS error'

        console.error('api/zones create zone in PowerDNS failed', {
          organizationId: activeOrganization.id,
          name: normalizedName,
          error: providerError,
        })

        res.status(200).json({
          ok: false,
          error: providerMessage,
          provider: 'powerdns',
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
    console.error('api/zones failed', {
      method: req.method,
      query: req.query,
      body: req.body,
      error,
    })
    res.status(200).json({ ok: false, zones: [], error: message })
  }
}
