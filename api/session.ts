import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Pool } from 'pg'

export const config = {
  runtime: 'nodejs',
}

let pool: Pool | undefined
const FALLBACK_USER_EMAIL = 'test@example.com'

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

function getSingleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }

  return value ?? ''
}

async function getRequestContext(req: VercelRequest) {
  const db = getPool()
  const requestedUserEmail = String(req.headers['x-user-email'] ?? '').trim()
  const userEmail = requestedUserEmail || FALLBACK_USER_EMAIL

  const currentUserResult = await db.query('select id, email, name from users where email = $1 limit 1', [
    userEmail,
  ])
  const currentUser =
    currentUserResult.rows[0] ??
    (
      await db.query('select id, email, name from users where email = $1 limit 1', [
        FALLBACK_USER_EMAIL,
      ])
    ).rows[0]

  if (!currentUser) {
    console.error('api/session could not resolve current user', {
      requestedUserEmail,
      fallbackUserEmail: FALLBACK_USER_EMAIL,
    })

    return {
      currentUser: null,
      memberships: [],
      activeOrganization: null,
    }
  }

  const membershipsResult = await db.query(
    `select om.organization_id as "organizationId", om.role,
            o.name as "organizationName", o.slug as "organizationSlug"
     from organization_members om
     inner join organizations o on o.id = om.organization_id
     where om.user_id = $1
     order by o.created_at asc`,
    [currentUser.id],
  )

  const memberships = membershipsResult.rows

  if (memberships.length === 0) {
    return {
      currentUser,
      memberships: [],
      activeOrganization: null,
    }
  }

  const requestedOrganizationId =
    String(req.headers['x-organization-id'] ?? '').trim() ||
    String(getSingleValue(req.query.organizationId)).trim() ||
    String((req.body as { organizationId?: string } | undefined)?.organizationId ?? '').trim()

  const activeOrganization =
    memberships.find((membership) => membership.organizationId === requestedOrganizationId) ??
    memberships[0]

  return {
    currentUser,
    memberships,
    activeOrganization: activeOrganization
      ? {
          id: activeOrganization.organizationId,
          name: activeOrganization.organizationName,
          slug: activeOrganization.organizationSlug,
          role: activeOrganization.role,
        }
      : null,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'Method not allowed' })
      return
    }

    const context = await getRequestContext(req)

    res.status(200).json({
      ok: true,
      currentUser: context.currentUser,
      memberships: context.memberships,
      activeOrganization: context.activeOrganization,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown session error'
    console.error('api/session failed', {
      method: req.method,
      query: req.query,
      headers: {
        'x-user-email': req.headers['x-user-email'],
        'x-organization-id': req.headers['x-organization-id'],
      },
      error,
    })
    res.status(200).json({
      ok: false,
      error: message,
      currentUser: null,
      memberships: [],
      activeOrganization: null,
    })
  }
}
