import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Pool } from 'pg'
import { getRequestContext } from '../../../lib/request-context.ts'

export const config = {
  runtime: 'nodejs',
}

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

function getSingleQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }

  return value ?? ''
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
