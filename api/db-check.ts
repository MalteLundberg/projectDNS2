import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkDatabaseConnection } from '../lib/db.ts'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const result = await checkDatabaseConnection()

    res.status(200).json({
      ok: true,
      service: 'api/db-check',
      message: 'Database connection OK',
      timestamp: result.checkedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error'

    res.status(500).json({
      ok: false,
      service: 'api/db-check',
      message,
    })
  }
}
