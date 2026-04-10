import { eq } from 'drizzle-orm'
import { getDb, getPool } from '../lib/database.ts'
import { organizationMembers, organizations, users } from './schema.ts'

async function main() {
  const db = getDb()

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, 'test@example.com'))
    .limit(1)

  const user =
    existingUser ??
    (
      await db
        .insert(users)
        .values({
          email: 'test@example.com',
          name: 'Test User',
        })
        .returning()
    )[0]

  const [existingOrganization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, 'test-organization'))
    .limit(1)

  const organization =
    existingOrganization ??
    (
      await db
        .insert(organizations)
        .values({
          name: 'Test Organization',
          slug: 'test-organization',
          createdByUserId: user.id,
        })
        .returning()
    )[0]

  const [existingMembership] = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organization.id))
    .limit(1)

  if (!existingMembership) {
    await db.insert(organizationMembers).values({
      organizationId: organization.id,
      userId: user.id,
      role: 'admin',
    })
  }

  console.log(
    JSON.stringify(
      {
        userId: user.id,
        organizationId: organization.id,
      },
      null,
      2,
    ),
  )

  await getPool().end()
}

main().catch(async (error) => {
  console.error(error)
  await getPool().end()
  process.exit(1)
})
