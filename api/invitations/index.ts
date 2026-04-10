import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  createInvitation,
  getOrganizationById,
  getOrganizationMember,
  getUserByEmail,
  listInvitations,
} from '../../lib/database.ts'

export const config = {
  runtime: 'nodejs',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const organizationId = String(req.query.organizationId ?? '')

      if (!organizationId) {
        res.status(400).json({ ok: false, error: 'organizationId is required' })
        return
      }

      const organization = await getOrganizationById(organizationId)

      if (!organization) {
        res.status(404).json({ ok: false, error: 'Organization not found' })
        return
      }

      const invitations = await listInvitations(organizationId)
      res.status(200).json({ ok: true, invitations })
      return
    }

    if (req.method === 'POST') {
      const { organizationId, email, role, invitedByEmail } = req.body ?? {}

      if (!organizationId || !email || !role || !invitedByEmail) {
        res.status(400).json({
          ok: false,
          error: 'organizationId, email, role and invitedByEmail are required',
        })
        return
      }

      if (role !== 'admin' && role !== 'user') {
        res.status(400).json({ ok: false, error: 'role must be admin or user' })
        return
      }

      const organization = await getOrganizationById(String(organizationId))

      if (!organization) {
        res.status(404).json({ ok: false, error: 'Organization not found' })
        return
      }

      const invitedByUser = await getUserByEmail(String(invitedByEmail))

      if (!invitedByUser) {
        res.status(400).json({ ok: false, error: 'Inviter user not found' })
        return
      }

      const inviterMembership = await getOrganizationMember({
        organizationId: String(organizationId),
        userId: invitedByUser.id,
      })

      if (!inviterMembership) {
        res.status(403).json({ ok: false, error: 'Inviter is not a member of the organization' })
        return
      }

      const invitation = await createInvitation({
        organizationId: String(organizationId),
        email: String(email),
        role,
        invitedByUserId: invitedByUser.id,
      })

      res.status(201).json({ ok: true, invitation })
      return
    }

    res.status(405).json({ ok: false, error: 'Method not allowed' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown invitations error'
    res.status(500).json({ ok: false, error: message })
  }
}
