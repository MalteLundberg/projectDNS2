import { neon } from '@neondatabase/serverless'

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  return databaseUrl
}

export async function checkDatabaseConnection() {
  const sql = neon(getDatabaseUrl())
  const result = await sql`SELECT NOW() AS now`

  return {
    ok: true,
    checkedAt: String(result[0]?.now ?? ''),
  }
}
