import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Pool } from 'pg'
import { getRequestContext } from '../../lib/request-context.ts'

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
    const db = getPool()
    const context = await getRequestContext(req)

    if (!context.currentUser.id) {
      res.status(200).json({ ok: false, invitations: [], error: 'Current user could not be resolved' })
      return
    }

    if (req.method === 'GET') {
      const organizationId =
        String(getSingleQueryValue(req.query.organizationId)).trim() || context.activeOrganization.id

      if (!organizationId) {
        res.status(200).json({ ok: true, invitations: [] })
        return
      }

      const organizationResult = await db.query('select id from organizations where id = $1 limit 1', [
        organizationId,
      ])

      if (organizationResult.rowCount === 0) {
        res.status(404).json({ ok: false, error: 'Organization not found' })
        return
      }

      const invitationsResult = await db.query(
        `select id, organization_id as "organizationId", email, role, status,
                invited_by_user_id as "invitedByUserId", created_at as "createdAt"
         from invitations
         where organization_id = $1
         order by created_at desc`,
        [organizationId],
      )

      res.status(200).json({ ok: true, invitations: invitationsResult.rows })
      return
    }

    if (req.method === 'POST') {
      const { organizationId, email, role } = req.body ?? {}

      if (!email || !role) {
        res.status(400).json({
          ok: false,
          error: 'email and role are required',
        })
        return
      }

      if (role !== 'admin' && role !== 'user') {
        res.status(400).json({ ok: false, error: 'role must be admin or user' })
        return
      }

      const normalizedOrganizationId = String(organizationId ?? context.activeOrganization.id).trim()
      const organizationResult = await db.query('select id from organizations where id = $1 limit 1', [
        normalizedOrganizationId,
      ])

      if (organizationResult.rowCount === 0) {
        res.status(404).json({ ok: false, error: 'Organization not found' })
        return
      }

      const inviterMembershipResult = await db.query(
        'select id from organization_members where organization_id = $1 and user_id = $2 limit 1',
        [normalizedOrganizationId, context.currentUser.id],
      )

      if (inviterMembershipResult.rowCount === 0) {
        res.status(403).json({ ok: false, error: 'Inviter is not a member of the organization' })
        return
      }

      const invitationResult = await db.query(
        `insert into invitations (organization_id, email, role, status, invited_by_user_id)
         values ($1, $2, $3, 'pending', $4)
         returning id, organization_id as "organizationId", email, role, status,
                   invited_by_user_id as "invitedByUserId", created_at as "createdAt"`,
        [normalizedOrganizationId, String(email).trim(), role, context.currentUser.id],
      )

      res.status(201).json({ ok: true, invitation: invitationResult.rows[0] })
      return
    }

    res.status(405).json({ ok: false, error: 'Method not allowed' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown invitations error'
    console.error('api/invitations failed', {
      method: req.method,
      query: req.query,
      body: req.body,
      error,
    })
    res.status(200).json({ ok: false, invitations: [], error: message })
  }
}
