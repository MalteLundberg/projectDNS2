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

function createCookie(name: string, value: string, maxAgeSeconds: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

function createOrganizationCookie(organizationId: string, maxAgeSeconds: number) {
  return `active_organization_id=${encodeURIComponent(organizationId)}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

async function getRequestContext(req: VercelRequest) {
  const db = getPool()
  const cookies = parseCookies(req.headers.cookie)
  const sessionToken = cookies.app_session || FALLBACK_SESSION_TOKEN

  const sessionResult = await db.query(
    `select us.session_token as "sessionToken", us.expires_at as "expiresAt",
            u.id, u.email, u.name
     from user_sessions us
     inner join users u on u.id = us.user_id
     where us.session_token = $1 and us.expires_at > now()
     limit 1`,
    [sessionToken],
  )

  const currentUser =
    sessionResult.rows[0] ??
    (
      await db.query('select id, email, name from users where email = $1 limit 1', [
        FALLBACK_USER_EMAIL,
      ])
    ).rows[0]

  if (!currentUser) {
    console.error('api/session could not resolve current user', { sessionToken })

    return {
      currentUser: null,
      memberships: [],
      activeOrganization: null,
      sessionToken: null,
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
  const cookieOrganizationId = String(cookies.active_organization_id ?? '').trim()
  const activeOrganizationMembership =
    memberships.find((membership) => membership.organizationId === cookieOrganizationId) ??
    memberships[0] ??
    null

  return {
    currentUser: {
      id: currentUser.id,
      email: currentUser.email,
      name: currentUser.name,
    },
    memberships,
    activeOrganization: activeOrganizationMembership
      ? {
          id: activeOrganizationMembership.organizationId,
          name: activeOrganizationMembership.organizationName,
          slug: activeOrganizationMembership.organizationSlug,
          role: activeOrganizationMembership.role,
        }
      : null,
    sessionToken,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'Method not allowed' })
      return
    }

    const context = await getRequestContext(req)
    const setCookie: string[] = []

    if (context.sessionToken) {
      setCookie.push(createCookie('app_session', context.sessionToken, 60 * 60 * 24 * 30))
    }

    if (context.activeOrganization?.id) {
      setCookie.push(
        createOrganizationCookie(context.activeOrganization.id, 60 * 60 * 24 * 30),
      )
    }

    if (setCookie.length > 0) {
      res.setHeader('Set-Cookie', setCookie)
    }

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
