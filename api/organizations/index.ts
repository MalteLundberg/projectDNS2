import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  addOrganizationMember,
  createOrganization,
  getOrganizationBySlug,
  getUserByEmail,
  listOrganizations,
} from '../../lib/database.ts'

export const config = {
  runtime: 'nodejs',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const rows = await listOrganizations()
      res.status(200).json({ ok: true, organizations: rows })
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

      const createdByUser = await getUserByEmail(String(createdByEmail))

      if (!createdByUser) {
        res.status(400).json({ ok: false, error: 'Creator user not found' })
        return
      }

      const existingOrganization = await getOrganizationBySlug(String(slug))

      if (existingOrganization) {
        res.status(409).json({ ok: false, error: 'Organization slug already exists' })
        return
      }

      const organization = await createOrganization({
        name: String(name),
        slug: String(slug),
        createdByUserId: createdByUser.id,
      })

      await addOrganizationMember({
        organizationId: organization.id,
        userId: createdByUser.id,
        role: 'admin',
      })

      res.status(201).json({ ok: true, organization })
      return
    }

    res.status(405).json({ ok: false, error: 'Method not allowed' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown organizations error'
    res.status(500).json({ ok: false, error: message })
  }
}
