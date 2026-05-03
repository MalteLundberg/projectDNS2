import test from "node:test";
import assert from "node:assert/strict";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { QueryResult, QueryResultRow } from "pg";
import { ZoneApiError } from "../../../lib/powerdns.js";
import { buildZoneDetailHandler } from "./[id]/index.js";
import { buildZoneRecordsHandler } from "./[id]/records.js";
import { buildZonesHandler } from "./index.js";

type MockResponse = VercelResponse & {
  statusCode: number;
  jsonBody: unknown | undefined;
};

type TestQueryWithRls = ReturnType<typeof buildZonesHandler> extends (
  req: VercelRequest,
  res: VercelResponse,
) => Promise<void>
  ? <T extends QueryResultRow = QueryResultRow>(input: {
      userId: string;
      userEmail?: string | null;
      organizationId?: string | null;
      text: string;
      values?: unknown[];
    }) => Promise<QueryResult<T>>
  : never;

function createQueryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    rows,
    fields: [],
  } as QueryResult<T>;
}

function createMockResponse() {
  const response: {
    statusCode: number;
    jsonBody: unknown | undefined;
    headers: Record<string, string | string[]>;
    status(code: number): unknown;
    json(body: unknown): unknown;
    setHeader(name: string, value: string | string[]): void;
  } = {
    statusCode: 200,
    jsonBody: undefined,
    headers: {} as Record<string, string | string[]>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.jsonBody = body;
      return this;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
  };

  return response as unknown as MockResponse;
}

function createQueryWithRlsMock(rowsOrFactory: QueryResultRow[] | ((text: string) => QueryResultRow[])) {
  return (async ({ text }) => {
    const rows = typeof rowsOrFactory === "function" ? rowsOrFactory(text) : rowsOrFactory;
    return createQueryResult(rows);
  }) as TestQueryWithRls;
}

function createRequest(overrides: Partial<VercelRequest> = {}) {
  return {
    method: "GET",
    headers: {},
    query: {},
    body: undefined,
    ...overrides,
  } as VercelRequest;
}

const adminContext = {
  currentUser: { id: "user-1", email: "admin@example.com", name: "Admin" },
  sessionToken: "session-1",
  activeOrganization: { id: "org-1", name: "Org 1", slug: "org-1", role: "admin" as const },
  memberships: [
    {
      organizationId: "org-1",
      organizationName: "Org 1",
      organizationSlug: "org-1",
      role: "admin" as const,
    },
  ],
};

const userContext = {
  ...adminContext,
  activeOrganization: { id: "org-1", name: "Org 1", slug: "org-1", role: "user" as const },
  memberships: [
    {
      organizationId: "org-1",
      organizationName: "Org 1",
      organizationSlug: "org-1",
      role: "user" as const,
    },
  ],
};

test("GET /api/zones lists zones for active organization", async () => {
  const handler = buildZonesHandler({
    requireRequestContext: async () => adminContext,
    queryWithRls: createQueryWithRlsMock([{ id: "zone-1", name: "example.com." }]),
    createZone: async () => {
      throw new Error("not used");
    },
  });
  const req = createRequest({ method: "GET" });
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, {
    ok: true,
    zones: [{ id: "zone-1", name: "example.com." }],
  });
});

test("POST /api/zones denies non-admin users", async () => {
  const handler = buildZonesHandler({
    requireRequestContext: async () => userContext,
    queryWithRls: createQueryWithRlsMock([]),
    createZone: async () => ({ id: "provider-zone", name: "example.com." }),
  });
  const req = createRequest({ method: "POST", body: { name: "example.com" } });
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    error: "Only organization admins can create zones",
  });
});

test("POST /api/zones returns provider errors with HTTP status", async () => {
  const handler = buildZonesHandler({
    requireRequestContext: async () => adminContext,
    queryWithRls: createQueryWithRlsMock([]),
    createZone: async () => {
      throw new ZoneApiError("POWERDNS_UNREACHABLE", "PowerDNS API is not reachable");
    },
  });
  const req = createRequest({ method: "POST", body: { name: "example.com" } });
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    error: "PowerDNS API is not reachable",
    code: "POWERDNS_UNREACHABLE",
    details: undefined,
    provider: "powerdns",
  });
});

test("POST /api/zones returns DB failure after successful provider create", async () => {
  const handler = buildZonesHandler({
    requireRequestContext: async () => adminContext,
    queryWithRls: (async ({ text }) => {
      if (text.includes("select id from dns_zones")) {
        return createQueryResult([]);
      }

      throw new Error("insert failed");
    }) as TestQueryWithRls,
    createZone: async () => ({ id: "provider-zone-1", name: "example.com." }),
  });
  const req = createRequest({ method: "POST", body: { name: "example.com" } });
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    error: "insert failed",
    code: "DNS_ZONE_SAVE_FAILED",
    details: undefined,
    provider: {
      name: "powerdns",
      zoneId: "provider-zone-1",
    },
  });
});

test("DELETE /api/zones/:id denies non-admin users", async () => {
  const handler = buildZoneDetailHandler({
    requireRequestContext: async () => userContext,
    queryWithRls: createQueryWithRlsMock([
      { id: "zone-1", organizationId: "org-1", name: "example.com.", powerdnsZoneId: "pdns-1" },
    ]),
    deleteZone: async () => null,
  });
  const req = createRequest({ method: "DELETE", query: { id: "zone-1" } });
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    error: "Only organization admins can delete zones",
  });
});

test("DELETE /api/zones/:id deletes provider zone before DB ownership row", async () => {
  const calls: string[] = [];
  const handler = buildZoneDetailHandler({
    requireRequestContext: async () => adminContext,
    queryWithRls: createQueryWithRlsMock((text) => {
      if (text.includes("select id, organization_id as \"organizationId\", name")) {
        calls.push("load-db");
        return [
          { id: "zone-1", organizationId: "org-1", name: "example.com.", powerdnsZoneId: "pdns-1" },
        ];
      }

      calls.push("delete-db");
      return [{ id: "zone-1" }];
    }),
    deleteZone: async () => {
      calls.push("delete-provider");
      return null;
    },
  });
  const req = createRequest({ method: "DELETE", query: { id: "zone-1" } });
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, ["load-db", "delete-provider", "delete-db"]);
  assert.deepEqual(res.jsonBody, {
    ok: true,
    zone: {
      id: "zone-1",
      organizationId: "org-1",
      name: "example.com.",
      powerdnsZoneId: "pdns-1",
    },
  });
});

test("DELETE /api/zones/:id returns provider delete failure", async () => {
  const handler = buildZoneDetailHandler({
    requireRequestContext: async () => adminContext,
    queryWithRls: createQueryWithRlsMock([
      { id: "zone-1", organizationId: "org-1", name: "example.com.", powerdnsZoneId: "pdns-1" },
    ]),
    deleteZone: async () => {
      throw new ZoneApiError("POWERDNS_ZONE_DELETE_FAILED", "Provider zone delete failed", {
        status: 502,
      });
    },
  });
  const req = createRequest({ method: "DELETE", query: { id: "zone-1" } });
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    error: "Provider zone delete failed",
    code: "POWERDNS_ZONE_DELETE_FAILED",
    details: { status: 502 },
  });
});

test("GET /api/zones/:id/records allows organization member access", async () => {
  const handler = buildZoneRecordsHandler({
    requireRequestContext: async () => userContext,
    queryWithRls: createQueryWithRlsMock([
      { id: "zone-1", organizationId: "org-1", name: "example.com.", powerdnsZoneId: "pdns-1" },
    ]),
    getZone: async () => ({
      id: "pdns-1",
      name: "example.com.",
      rrsets: [{ name: "example.com.", type: "A", ttl: 3600, records: [{ content: "1.2.3.4" }] }],
    }),
    patchZoneRecords: async () => null,
  });
  const req = createRequest({ method: "GET", query: { id: "zone-1" } });
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, {
    ok: true,
    zone: { id: "zone-1", name: "example.com.", powerdnsZoneId: "pdns-1" },
    rrsets: [{ name: "example.com.", type: "A", ttl: 3600, records: [{ content: "1.2.3.4", disabled: false }] }],
  });
});

test("PATCH /api/zones/:id/records updates an existing record", async () => {
  const patchCalls: unknown[] = [];
  let getZoneCallCount = 0;
  const handler = buildZoneRecordsHandler({
    requireRequestContext: async () => adminContext,
    queryWithRls: createQueryWithRlsMock([
      { id: "zone-1", organizationId: "org-1", name: "example.com.", powerdnsZoneId: "pdns-1" },
    ]),
    getZone: async () => {
      getZoneCallCount += 1;

      if (getZoneCallCount === 1) {
        return {
          id: "pdns-1",
          name: "example.com.",
          rrsets: [{ name: "www.example.com.", type: "A", ttl: 3600, records: [{ content: "1.2.3.4" }] }],
        };
      }

      return {
        id: "pdns-1",
        name: "example.com.",
        rrsets: [{ name: "www.example.com.", type: "A", ttl: 7200, records: [{ content: "5.6.7.8" }] }],
      };
    },
    patchZoneRecords: async (_zoneId, rrsets) => {
      patchCalls.push(rrsets);
      return null;
    },
  });
  const req = createRequest({
    method: "PATCH",
    query: { id: "zone-1" },
    body: {
      currentName: "www",
      currentType: "A",
      currentContent: "1.2.3.4",
      name: "www",
      type: "A",
      content: "5.6.7.8",
      ttl: 7200,
    },
  });
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(patchCalls, [
    [
      {
        name: "www.example.com.",
        type: "A",
        ttl: 7200,
        changetype: "REPLACE",
        records: [{ content: "5.6.7.8", disabled: false }],
      },
    ],
  ]);
});

test("DELETE /api/zones/:id/records denies users outside the organization", async () => {
  const handler = buildZoneRecordsHandler({
    requireRequestContext: async () => ({
      ...adminContext,
      memberships: [],
    }),
    queryWithRls: createQueryWithRlsMock([
      { id: "zone-1", organizationId: "org-2", name: "example.com.", powerdnsZoneId: "pdns-1" },
    ]),
    getZone: async () => ({ id: "pdns-1", name: "example.com." }),
    patchZoneRecords: async () => null,
  });
  const req = createRequest({
    method: "DELETE",
    query: { id: "zone-1", name: "www", type: "A", content: "1.2.3.4" },
  });
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    error: "Access denied for zone",
  });
});
