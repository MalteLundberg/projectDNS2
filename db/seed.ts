import { eq } from "drizzle-orm";
import { getDb, getPool } from "../lib/database";
import { organizationMembers, organizations, users } from "./schema";

const TEST_SESSION_TOKEN = "dev-test-session-token";
const SECOND_SESSION_TOKEN = "dev-second-session-token";

async function main() {
  const db = getDb();

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, "test@example.com"))
    .limit(1);

  const user =
    existingUser ??
    (
      await db
        .insert(users)
        .values({
          email: "test@example.com",
          name: "Test User",
        })
        .returning()
    )[0];

  const [existingOrganization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, "test-organization"))
    .limit(1);

  const organization =
    existingOrganization ??
    (
      await db
        .insert(organizations)
        .values({
          name: "Test Organization",
          slug: "test-organization",
          createdByUserId: user.id,
        })
        .returning()
    )[0];

  const [existingMembership] = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organization.id))
    .limit(1);

  if (!existingMembership) {
    await db.insert(organizationMembers).values({
      organizationId: organization.id,
      userId: user.id,
      role: "admin",
    });
  }

  const [existingSecondUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, "member@example.com"))
    .limit(1);

  const secondUser =
    existingSecondUser ??
    (
      await db
        .insert(users)
        .values({
          email: "member@example.com",
          name: "Member User",
        })
        .returning()
    )[0];

  const [existingSecondOrganization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, "second-organization"))
    .limit(1);

  const secondOrganization =
    existingSecondOrganization ??
    (
      await db
        .insert(organizations)
        .values({
          name: "Second Organization",
          slug: "second-organization",
          createdByUserId: secondUser.id,
        })
        .returning()
    )[0];

  const [existingSecondMembership] = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, secondOrganization.id))
    .limit(1);

  if (!existingSecondMembership) {
    await db.insert(organizationMembers).values({
      organizationId: secondOrganization.id,
      userId: secondUser.id,
      role: "admin",
    });
  }

  const pool = getPool();

  const existingSessionResult = await pool.query(
    "select id from user_sessions where session_token = $1 limit 1",
    [TEST_SESSION_TOKEN],
  );

  if (existingSessionResult.rowCount === 0) {
    await pool.query(
      `insert into user_sessions (session_token, user_id, expires_at)
       values ($1, $2, $3)`,
      [TEST_SESSION_TOKEN, user.id, "2099-01-01T00:00:00.000Z"],
    );
  }

  const existingSecondSessionResult = await pool.query(
    "select id from user_sessions where session_token = $1 limit 1",
    [SECOND_SESSION_TOKEN],
  );

  if (existingSecondSessionResult.rowCount === 0) {
    await pool.query(
      `insert into user_sessions (session_token, user_id, expires_at)
       values ($1, $2, $3)`,
      [SECOND_SESSION_TOKEN, secondUser.id, "2099-01-01T00:00:00.000Z"],
    );
  }

  const existingSecondInvitationResult = await pool.query(
    "select id from invitations where organization_id = $1 and email = $2 limit 1",
    [secondOrganization.id, "second-invite@example.com"],
  );

  if (existingSecondInvitationResult.rowCount === 0) {
    await pool.query(
      `insert into invitations (organization_id, email, role, status, invited_by_user_id)
       values ($1, $2, 'user', 'pending', $3)`,
      [secondOrganization.id, "second-invite@example.com", secondUser.id],
    );
  }

  console.log(
    JSON.stringify(
      {
        userId: user.id,
        organizationId: organization.id,
        sessionToken: TEST_SESSION_TOKEN,
        secondUserId: secondUser.id,
        secondOrganizationId: secondOrganization.id,
        secondSessionToken: SECOND_SESSION_TOKEN,
      },
      null,
      2,
    ),
  );

  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await getPool().end();
  process.exit(1);
});
