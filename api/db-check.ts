import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'nodejs',
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const databaseUrl = process.env.DATABASE_URL

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set')
    }

    const sql = neon(databaseUrl)
    const result = await sql`select now() as now`

    res.status(200).json({
      ok: true,
      service: 'api/db-check',
      message: 'Database connection OK',
      timestamp: String(result[0]?.now ?? ''),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error'

    res.status(500).json({
      ok: false,
      service: 'api/db-check',
      error: message,
    })
  }
}
