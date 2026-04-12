import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Pool } from 'pg'

export const config = {
  runtime: 'nodejs',
}

let pool: Pool | undefined
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

function createOrganizationCookie(organizationId: string, maxAgeSeconds: number) {
  return `active_organization_id=${encodeURIComponent(organizationId)}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method not allowed' })
      return
    }

    const { organizationId } = req.body ?? {}

    if (!organizationId) {
      res.status(400).json({ ok: false, error: 'organizationId is required' })
      return
    }

    const db = getPool()
    const cookies = parseCookies(req.headers.cookie)
    const sessionToken = cookies.app_session || FALLBACK_SESSION_TOKEN

    const sessionResult = await db.query(
      `select u.id
       from user_sessions us
       inner join users u on u.id = us.user_id
       where us.session_token = $1 and us.expires_at > now()
       limit 1`,
      [sessionToken],
    )

    const currentUser = sessionResult.rows[0]

    if (!currentUser) {
      res.status(200).json({ ok: false, error: 'Current session user could not be resolved' })
      return
    }

    const membershipResult = await db.query(
      `select om.organization_id as "organizationId", o.name, o.slug, om.role
       from organization_members om
       inner join organizations o on o.id = om.organization_id
       where om.user_id = $1 and om.organization_id = $2
       limit 1`,
      [currentUser.id, String(organizationId).trim()],
    )

    const membership = membershipResult.rows[0]

    if (!membership) {
      res.status(200).json({ ok: false, error: 'Organization is not available for current user' })
      return
    }

    res.setHeader('Set-Cookie', createOrganizationCookie(membership.organizationId, 60 * 60 * 24 * 30))
    res.status(200).json({
      ok: true,
      activeOrganization: {
        id: membership.organizationId,
        name: membership.name,
        slug: membership.slug,
        role: membership.role,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown active organization error'
    console.error('api/session/active-organization failed', {
      method: req.method,
      body: req.body,
      error,
    })
    res.status(200).json({ ok: false, error: message })
  }
}
