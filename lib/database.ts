import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  invitations,
  organizationMembers,
  organizations,
  users,
  type invitationStatuses,
  type userRoles,
} from "../db/schema";

let pool: Pool | undefined;

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  return databaseUrl;
}

export function getDb() {
  pool ??= new Pool({
    connectionString: getDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });

  return drizzle(pool);
}

export function getPool() {
  pool ??= new Pool({
    connectionString: getDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });

  return pool;
}

export type OrganizationRole = (typeof userRoles)[number];
export type InvitationStatus = (typeof invitationStatuses)[number];

export async function listOrganizations() {
  const db = getDb();

  return db.select().from(organizations).orderBy(organizations.createdAt);
}

export async function createOrganization(input: {
  name: string;
  slug: string;
  createdByUserId: string;
}) {
  const db = getDb();

  return (
    await db
      .insert(organizations)
      .values({
        name: input.name,
        slug: input.slug,
        createdByUserId: input.createdByUserId,
      })
      .returning()
  )[0];
}

export async function addOrganizationMember(input: {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}) {
  const db = getDb();

  return (
    await db
      .insert(organizationMembers)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
      })
      .returning()
  )[0];
}

export async function listOrganizationMembers(organizationId: string) {
  const db = getDb();

  return db
    .select({
      id: organizationMembers.id,
      role: organizationMembers.role,
      createdAt: organizationMembers.createdAt,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(users.name);
}

export async function listInvitations(organizationId: string) {
  const db = getDb();

  return db
    .select()
    .from(invitations)
    .where(eq(invitations.organizationId, organizationId))
    .orderBy(desc(invitations.createdAt));
}

export async function createInvitation(input: {
  organizationId: string;
  email: string;
  role: OrganizationRole;
  invitedByUserId: string;
}) {
  const db = getDb();

  return (
    await db
      .insert(invitations)
      .values({
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        status: "pending",
        invitedByUserId: input.invitedByUserId,
      })
      .returning()
  )[0];
}

export async function getUserByEmail(email: string) {
  const db = getDb();

  return (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
}

export async function getOrganizationBySlug(slug: string) {
  const db = getDb();

  return (await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1))[0];
}

export async function getOrganizationById(id: string) {
  const db = getDb();

  return (await db.select().from(organizations).where(eq(organizations.id, id)).limit(1))[0];
}

export async function getOrganizationMember(input: { organizationId: string; userId: string }) {
  const db = getDb();

  return (
    await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, input.organizationId),
          eq(organizationMembers.userId, input.userId),
        ),
      )
      .limit(1)
  )[0];
}
