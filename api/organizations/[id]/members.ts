import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getOrganizationById, listOrganizationMembers } from '../../../lib/database.ts'

export const config = {
  runtime: 'nodejs',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'Method not allowed' })
      return
    }

    const organizationId = String(req.query.id ?? '')

    if (!organizationId) {
      res.status(400).json({ ok: false, error: 'Organization id is required' })
      return
    }

    const organization = await getOrganizationById(organizationId)

    if (!organization) {
      res.status(404).json({ ok: false, error: 'Organization not found' })
      return
    }

    const members = await listOrganizationMembers(organizationId)
    res.status(200).json({ ok: true, members })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown members error'
    res.status(500).json({ ok: false, error: message })
  }
}
