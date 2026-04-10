import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Pool } from 'pg'

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const db = getPool()

    if (req.method === 'GET') {
      const result = await db.query(
        `select id, name, slug, created_by_user_id as "createdByUserId", created_at as "createdAt"
         from organizations
         order by created_at asc`,
      )

      res.status(200).json({ ok: true, organizations: result.rows })
      return
    }

    if (req.method === 'POST') {
      const { name, slug, createdByEmail } = req.body ?? {}

      if (!name || !slug || !createdByEmail) {
        res.status(400).json({
          ok: false,
          error: 'name, slug and createdByEmail are required',
        })
        return
      }

      const createdByUserResult = await db.query('select id from users where email = $1 limit 1', [
        String(createdByEmail).trim(),
      ])
      const createdByUser = createdByUserResult.rows[0]

      if (!createdByUser) {
        res.status(400).json({ ok: false, error: 'Creator user not found' })
        return
      }

      const normalizedSlug = String(slug).trim()
      const existingOrganizationResult = await db.query(
        'select id from organizations where slug = $1 limit 1',
        [normalizedSlug],
      )

      if (existingOrganizationResult.rowCount !== 0) {
        res.status(409).json({ ok: false, error: 'Organization slug already exists' })
        return
      }

      const organizationResult = await db.query(
        `insert into organizations (name, slug, created_by_user_id)
         values ($1, $2, $3)
         returning id, name, slug, created_by_user_id as "createdByUserId", created_at as "createdAt"`,
        [String(name).trim(), normalizedSlug, createdByUser.id],
      )

      const organization = organizationResult.rows[0]

      await db.query(
        `insert into organization_members (organization_id, user_id, role)
         values ($1, $2, 'admin')`,
        [organization.id, createdByUser.id],
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
    res.status(500).json({ ok: false, error: message })
  }
}
