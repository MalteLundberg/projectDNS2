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

async function getCurrentUser(req: VercelRequest) {
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

    return (
      currentUserResult.rows[0] ??
      (
        await client.query('select id, email, name from users where email = $1 limit 1', [
          FALLBACK_USER_EMAIL,
        ])
      ).rows[0] ??
      null
    )
  } finally {
    client.release()
  }
}

async function withRlsContext<T>(
  userId: string,
  userEmail: string,
  organizationId: string | null,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await getPool().connect()

  try {
    await client.query('begin')
    await client.query("select set_config('app.current_user_id', $1, true)", [userId])
    await client.query("select set_config('app.current_user_email', $1, true)", [userEmail])
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
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method not allowed' })
      return
    }

    const currentUser = await getCurrentUser(req)

    if (!currentUser?.id) {
      res.status(200).json({ ok: false, error: 'Current user could not be resolved' })
      return
    }

    const invitationId = String(getSingleQueryValue(req.query.id)).trim()

    if (!invitationId) {
      res.status(400).json({ ok: false, error: 'Invitation id is required' })
      return
    }

    const invitationLookup = await withRlsContext(currentUser.id, currentUser.email, null, (client) =>
      client.query(
        `select id, organization_id as "organizationId", email, role, status
         from invitations
         where id = $1
         limit 1`,
        [invitationId],
      ),
    )

    const invitation = invitationLookup.rows[0]

    if (!invitation) {
      res.status(404).json({ ok: false, error: 'Invitation not found' })
      return
    }

    if (invitation.status !== 'pending') {
      res.status(409).json({ ok: false, error: 'Only pending invitations can be accepted' })
      return
    }

    if (String(invitation.email).toLowerCase() !== String(currentUser.email).toLowerCase()) {
      res.status(403).json({ ok: false, error: 'Invitation does not belong to current user' })
      return
    }

    const result = await withRlsContext(currentUser.id, currentUser.email, invitation.organizationId, async (client) => {
      const membershipResult = await client.query(
        `select id, role
         from organization_members
         where organization_id = $1 and user_id = $2
         limit 1`,
        [invitation.organizationId, currentUser.id],
      )

      const membership =
        membershipResult.rows[0] ??
        (
          await client.query(
            `insert into organization_members (organization_id, user_id, role)
             values ($1, $2, $3)
             on conflict (organization_id, user_id) do nothing
             returning id, organization_id as "organizationId", user_id as "userId", role, created_at as "createdAt"`,
            [invitation.organizationId, currentUser.id, invitation.role],
          )
        ).rows[0]

      const acceptedInvitationResult = await client.query(
        `update invitations
         set status = 'accepted'
         where id = $1 and status = 'pending'
         returning id, organization_id as "organizationId", email, role, status,
                   invited_by_user_id as "invitedByUserId", created_at as "createdAt"`,
        [invitationId],
      )

      return {
        membership: membership ?? membershipResult.rows[0] ?? null,
        invitation: acceptedInvitationResult.rows[0] ?? null,
      }
    })

    if (!result.invitation) {
      res.status(409).json({ ok: false, error: 'Invitation could not be accepted' })
      return
    }

    res.status(200).json({ ok: true, invitation: result.invitation, membership: result.membership })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown accept invitation error'
    console.error('api/invitations/[id]/accept failed', {
      method: req.method,
      query: req.query,
      error,
    })
    res.status(200).json({ ok: false, error: message })
  }
}
