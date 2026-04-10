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

function getSingleQueryValue(value: string | string[] | undefined) {
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
    console.error('api/organizations/[id]/members could not resolve current user', {
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
  const requestedOrganizationId =
    String(req.headers['x-organization-id'] ?? '').trim() ||
    String(getSingleQueryValue(req.query.id)).trim()

  const activeOrganization =
    memberships.find((membership) => membership.organizationId === requestedOrganizationId) ??
    memberships[0] ??
    null

  return {
    currentUser,
    memberships,
    activeOrganization,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'Method not allowed' })
      return
    }

    const db = getPool()
    const context = await getRequestContext(req)
    const organizationId = String(getSingleQueryValue(req.query.id)).trim() || context.activeOrganization.id

    if (!context.currentUser.id) {
      res.status(200).json({ ok: false, members: [], error: 'Current user could not be resolved' })
      return
    }

    if (!organizationId) {
      res.status(200).json({ ok: true, members: [] })
      return
    }

    if (!context.memberships.some((membership) => membership.organizationId === organizationId)) {
      res.status(200).json({ ok: false, members: [], error: 'Access denied for organization' })
      return
    }

    const organizationResult = await db.query('select id from organizations where id = $1 limit 1', [
      organizationId,
    ])

    if (organizationResult.rowCount === 0) {
      res.status(404).json({ ok: false, error: 'Organization not found' })
      return
    }

    const membersResult = await db.query(
      `select om.id, om.role, om.created_at as "createdAt",
              u.id as "userId", u.name as "userName", u.email as "userEmail"
       from organization_members om
       inner join users u on om.user_id = u.id
       where om.organization_id = $1
       order by u.name asc`,
      [organizationId],
    )

    res.status(200).json({ ok: true, members: membersResult.rows })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown members error'
    console.error('api/organizations/[id]/members failed', {
      method: req.method,
      query: req.query,
      error,
    })
    res.status(200).json({ ok: false, members: [], error: message })
  }
}
