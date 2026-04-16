import { eq } from "drizzle-orm";
import { getDb, getPool } from "../lib/database.js";
import { organizationMembers, organizations, users } from "./schema.js";

const TEST_SESSION_TOKEN = "dev-test-session-token";
const SECOND_SESSION_TOKEN = "dev-second-session-token";

async function main() {
  const db = getDb();
  const pool = getPool();

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
    (await createOrganization(user.id, "Test Organization", "test-organization"));

  const [existingMembership] = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organization.id))
    .limit(1);

  if (!existingMembership) {
    await createMembership(user.id, organization.id, user.id, "admin");
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
    (await createOrganization(secondUser.id, "Second Organization", "second-organization"));

  const [existingSecondMembership] = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, secondOrganization.id))
    .limit(1);

  if (!existingSecondMembership) {
    await createMembership(secondUser.id, secondOrganization.id, secondUser.id, "admin");
  }

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

async function createOrganization(userId: string, name: string, slug: string) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("select set_config('app.current_user_id', $1, true)", [userId]);
    const organizationResult = await client.query(
      `insert into organizations (name, slug, created_by_user_id)
       values ($1, $2, $3)
       returning id, name, slug, created_by_user_id as "createdByUserId", created_at as "createdAt"`,
      [name, slug, userId],
    );
    await client.query("commit");
    return organizationResult.rows[0];
  } catch (error) {
    await client.query("rollback");

    if (error && typeof error === "object" && "code" in error && error.code === "42501") {
      const existingResult = await pool.query(
        `select id, name, slug, created_by_user_id as "createdByUserId", created_at as "createdAt"
         from organizations
         where slug = $1
         limit 1`,
        [slug],
      );

      if (existingResult.rowCount !== 0) {
        return existingResult.rows[0];
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

async function createMembership(
  actorUserId: string,
  organizationId: string,
  targetUserId: string,
  role: "admin" | "user",
) {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    await client.query("select set_config('app.current_user_id', $1, true)", [actorUserId]);
    await client.query("select set_config('app.current_organization_id', $1, true)", [
      organizationId,
    ]);
    await client.query(
      `insert into organization_members (organization_id, user_id, role)
       values ($1, $2, $3)`,
      [organizationId, targetUserId, role],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

main().catch(async (error) => {
  console.error(error);
  await getPool().end();
  process.exit(1);
});
