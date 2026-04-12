import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Pool, type PoolClient } from 'pg'

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
      console.error('api/organizations could not resolve current user', {
        sessionToken,
        fallbackUserEmail: FALLBACK_USER_EMAIL,
      })

      return {
        currentUser: null,
        memberships: [],
      }
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

    return {
      currentUser,
      memberships: membershipsResult.rows,
    }
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

    if (!context.currentUser.id) {
      res.status(200).json({ ok: false, organizations: [], error: 'Current user could not be resolved' })
      return
    }

    if (req.method === 'GET') {
      if (context.memberships.length === 0) {
        res.status(200).json({ ok: true, organizations: [] })
        return
      }

      const result = await withRlsContext(context.currentUser.id, null, (client) =>
        client.query(
          `select id, name, slug, created_by_user_id as "createdByUserId", created_at as "createdAt"
           from organizations
           order by created_at asc`,
        ),
      )

      res.status(200).json({ ok: true, organizations: result.rows })
      return
    }

    if (req.method === 'POST') {
      const { name, slug } = req.body ?? {}

      if (!name || !slug) {
        res.status(400).json({
          ok: false,
          error: 'name and slug are required',
        })
        return
      }

      const normalizedSlug = String(slug).trim()
      const existingOrganizationResult = await withRlsContext(context.currentUser.id, null, (client) =>
        client.query('select id from organizations where slug = $1 limit 1', [normalizedSlug]),
      )

      if (existingOrganizationResult.rowCount !== 0) {
        res.status(409).json({ ok: false, error: 'Organization slug already exists' })
        return
      }

      const organizationResult = await withRlsContext(context.currentUser.id, null, (client) =>
        client.query(
          `insert into organizations (name, slug, created_by_user_id)
           values ($1, $2, $3)
           returning id, name, slug, created_by_user_id as "createdByUserId", created_at as "createdAt"`,
          [String(name).trim(), normalizedSlug, context.currentUser.id],
        ),
      )

      const organization = organizationResult.rows[0]

      await withRlsContext(context.currentUser.id, organization.id, (client) =>
        client.query(
          `insert into organization_members (organization_id, user_id, role)
           values ($1, $2, 'admin')`,
          [organization.id, context.currentUser.id],
        ),
      )

      res.status(201).json({ ok: true, organization })
      return
    }

    res.status(405).json({ ok: false, error: 'Method not allowed' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown organizations error'
    console.error('api/organizations failed', {
      method: req.method,
      query: req.query,
      body: req.body,
      error,
    })
    res.status(200).json({ ok: false, organizations: [], error: message })
  }
}
