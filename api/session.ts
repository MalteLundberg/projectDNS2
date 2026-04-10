import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getRequestContext } from '../lib/request-context.ts'

export const config = {
  runtime: 'nodejs',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'Method not allowed' })
      return
    }

    const context = await getRequestContext(req)

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
      query: req.query,
      headers: {
        'x-user-email': req.headers['x-user-email'],
        'x-organization-id': req.headers['x-organization-id'],
      },
      error,
    })
    res.status(500).json({ ok: false, error: message })
  }
}
