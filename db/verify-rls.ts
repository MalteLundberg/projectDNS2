import { Pool, type PoolClient } from "pg";

type VerificationResult = {
  label: string;
  organizationId: string;
  organizations: Array<{ id: string; slug: string }>;
  invitations: Array<{ organizationId: string; email: string }>;
  dnsZones: Array<{ organizationId: string; name: string }>;
  dnsZonesAvailable: boolean;
  secondOrgMembers?: Array<{ organizationId: string; userId: string }>;
};

async function hasDnsZonesTable(client: PoolClient) {
  const result = await client.query(
    `select exists (
       select 1
       from information_schema.tables
       where table_schema = 'public' and table_name = 'dns_zones'
     ) as exists`,
  );

  return Boolean(result.rows[0]?.exists);
}

async function runAsUser(
  client: PoolClient,
  input: { userId: string; organizationId: string; label: string; checkSecondOrgMembers?: boolean },
): Promise<VerificationResult> {
  await client.query("begin");
  await client.query("select set_config('app.current_user_id', $1, true)", [input.userId]);
  await client.query("select set_config('app.current_organization_id', $1, true)", [
    input.organizationId,
  ]);

  const organizations = await client.query("select id, slug from organizations order by slug");
  const invitations = await client.query(
    'select organization_id as "organizationId", email from invitations order by email',
  );
  const dnsZonesAvailable = await hasDnsZonesTable(client);
  const dnsZones = dnsZonesAvailable
    ? await client.query(
        'select organization_id as "organizationId", name from dns_zones order by name',
      )
    : { rows: [] };

  let secondOrgMembers: VerificationResult["secondOrgMembers"] | undefined;

  if (input.checkSecondOrgMembers) {
    const members = await client.query(
      'select organization_id as "organizationId", user_id as "userId" from organization_members where organization_id = $1',
      ["5ea455a8-c984-41f3-b34c-7aad81a05655"],
    );
    secondOrgMembers = members.rows;
  }

  await client.query("rollback");

  return {
    label: input.label,
    organizationId: input.organizationId,
    organizations: organizations.rows,
    invitations: invitations.rows,
    dnsZones: dnsZones.rows,
    dnsZonesAvailable,
    secondOrgMembers,
  };
}

function summarize(result: VerificationResult) {
  const organizationSlugs = result.organizations.map((organization) => organization.slug);
  const invitationEmails = result.invitations.map((invitation) => invitation.email);
  const dnsZoneNames = result.dnsZones.map((dnsZone) => dnsZone.name);
  const dnsZoneOrganizationIds = result.dnsZones.map((dnsZone) => dnsZone.organizationId);
  const dnsZonesPass =
    !result.dnsZonesAvailable ||
    dnsZoneOrganizationIds.every((organizationId) => organizationId === result.organizationId);

  if (result.label === "firstUser") {
    const pass =
      organizationSlugs.length === 1 &&
      organizationSlugs[0] === "test-organization" &&
      invitationEmails.length === 1 &&
      invitationEmails[0] === "invited.person@example.com" &&
      dnsZonesPass &&
      (result.secondOrgMembers?.length ?? 0) === 0;

    return {
      pass,
      expected: {
        organizations: ["test-organization"],
        invitations: ["invited.person@example.com"],
        dnsZones: result.dnsZonesAvailable
          ? ["only zones owned by test-organization"]
          : ["dns_zones table not present in this environment"],
        secondOrgMembers: [],
      },
      actual: {
        organizations: organizationSlugs,
        invitations: invitationEmails,
        dnsZones: dnsZoneNames,
        dnsZoneOrganizationIds,
        dnsZonesAvailable: result.dnsZonesAvailable,
        secondOrgMembers: result.secondOrgMembers ?? [],
      },
    };
  }

  const pass =
    organizationSlugs.length === 1 &&
    organizationSlugs[0] === "second-organization" &&
    invitationEmails.length === 1 &&
    invitationEmails[0] === "second-invite@example.com" &&
    dnsZonesPass;

  return {
    pass,
    expected: {
      organizations: ["second-organization"],
      invitations: ["second-invite@example.com"],
      dnsZones: result.dnsZonesAvailable
        ? ["only zones owned by second-organization"]
        : ["dns_zones table not present in this environment"],
    },
    actual: {
      organizations: organizationSlugs,
      invitations: invitationEmails,
      dnsZones: dnsZoneNames,
      dnsZoneOrganizationIds,
      dnsZonesAvailable: result.dnsZonesAvailable,
    },
  };
}

async function runVerification() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();

  try {
    const firstUser = await runAsUser(client, {
      label: "firstUser",
      userId: "84432061-5cb3-4c26-a663-99760d00d4f2",
      organizationId: "75757080-781e-4039-8443-52d825a41568",
      checkSecondOrgMembers: true,
    });

    const secondUser = await runAsUser(client, {
      label: "secondUser",
      userId: "43d8f6a8-6c49-4025-b90c-4b477c15cba1",
      organizationId: "5ea455a8-c984-41f3-b34c-7aad81a05655",
    });

    const firstSummary = summarize(firstUser);
    const secondSummary = summarize(secondUser);

    console.log(
      JSON.stringify(
        {
          overallPass: firstSummary.pass && secondSummary.pass,
          firstUser: firstSummary,
          secondUser: secondSummary,
        },
        null,
        2,
      ),
    );
  } finally {
    client.release();
    await pool.end();
  }
}

runVerification().catch((error) => {
  console.error(error);
  process.exit(1);
});
