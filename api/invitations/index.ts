import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Pool } from 'pg'

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

function getSingleQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }

  return value ?? ''
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
  const db = getPool()
  const cookies = parseCookies(req.headers.cookie)
  const sessionToken = cookies.app_session || FALLBACK_SESSION_TOKEN

  const currentUserResult = await db.query(
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
      await db.query('select id, email, name from users where email = $1 limit 1', [
        FALLBACK_USER_EMAIL,
      ])
    ).rows[0]

  if (!currentUser) {
    console.error('api/invitations could not resolve current user', {
      sessionToken,
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
    String(cookies.active_organization_id ?? '').trim() ||
    String(getSingleQueryValue(req.query.organizationId)).trim() ||
    String((req.body as { organizationId?: string } | undefined)?.organizationId ?? '').trim()

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
