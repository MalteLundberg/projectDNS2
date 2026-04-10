import type { VercelRequest } from '@vercel/node'
import { Pool } from 'pg'

let pool: Pool | undefined

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

export type RequestContext = {
  currentUser: {
    id: string
    email: string
    name: string
  }
  memberships: Array<{
    organizationId: string
    role: 'admin' | 'user'
    organizationName: string
    organizationSlug: string
  }>
  activeOrganization: {
    id: string
    name: string
    slug: string
    role: 'admin' | 'user'
  }
}

export async function getRequestContext(req: VercelRequest): Promise<RequestContext> {
  const db = getPool()
  const userEmail = String(req.headers['x-user-email'] ?? '').trim()

  if (!userEmail) {
    throw new Error('x-user-email header is required')
  }

  const currentUserResult = await db.query(
    'select id, email, name from users where email = $1 limit 1',
    [userEmail],
  )

  const currentUser = currentUserResult.rows[0]

  if (!currentUser) {
    throw new Error('Current user not found')
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

  const memberships = membershipsResult.rows as RequestContext['memberships']

  if (memberships.length === 0) {
    throw new Error('Current user has no organization memberships')
  }

  const headerOrganizationId = String(req.headers['x-organization-id'] ?? '').trim()
  const queryOrganizationId = String(getSingleValue(req.query.organizationId)).trim()
  const body = req.body as { organizationId?: string } | undefined
  const bodyOrganizationId = String(body?.organizationId ?? '').trim()
  const requestedOrganizationId = headerOrganizationId || queryOrganizationId || bodyOrganizationId

  const activeMembership =
    memberships.find((membership) => membership.organizationId === requestedOrganizationId) ??
    memberships[0]

  if (!activeMembership) {
    throw new Error('Active organization could not be resolved')
  }

  return {
    currentUser,
    memberships,
    activeOrganization: {
      id: activeMembership.organizationId,
      name: activeMembership.organizationName,
      slug: activeMembership.organizationSlug,
      role: activeMembership.role,
    },
  }
}
