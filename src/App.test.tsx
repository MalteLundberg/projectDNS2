import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

function createJsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const jsonText = JSON.stringify(body);

  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type" ? "application/json" : null;
      },
    },
    async json() {
      return JSON.parse(jsonText);
    },
    async text() {
      return jsonText;
    },
  } as Response;
}

function createAdminFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url === "/api/session") {
      return createJsonResponse({
        ok: true,
        currentUser: { id: "user-1", email: "admin@example.com", name: "Admin" },
        memberships: [
          {
            organizationId: "org-1",
            role: "admin",
            organizationName: "Org 1",
            organizationSlug: "org-1",
          },
        ],
        activeOrganization: { id: "org-1", name: "Org 1", slug: "org-1", role: "admin" },
      });
    }

    if (url === "/api/organizations") {
      return createJsonResponse({
        ok: true,
        organizations: [{ id: "org-1", name: "Org 1", slug: "org-1", createdAt: "now" }],
      });
    }

    if (url === "/api/organizations/org-1/members") {
      return createJsonResponse({ ok: true, members: [] });
    }

    if (url === "/api/invitations?organizationId=org-1") {
      return createJsonResponse({ ok: true, invitations: [] });
    }

    if (url === "/api/zones" && method === "GET") {
      return createJsonResponse({
        ok: true,
        zones: [
          {
            id: "zone-1",
            organizationId: "org-1",
            name: "example.com.",
            provider: "powerdns",
            powerdnsZoneId: "pdns-zone-1",
            createdAt: "now",
          },
        ],
      });
    }

    if (url === "/api/zones/zone-1/records" && method === "GET") {
      return createJsonResponse({
        ok: true,
        zone: { id: "zone-1", name: "example.com.", powerdnsZoneId: "pdns-zone-1" },
        rrsets: [
          {
            name: "www.example.com.",
            type: "A",
            ttl: 3600,
            records: [{ content: "1.2.3.4", disabled: false }],
          },
        ],
      });
    }

    if (url === "/api/zones/zone-1/records" && method === "PATCH") {
      return createJsonResponse({
        ok: true,
        rrsets: [
          {
            name: "www.example.com.",
            type: "A",
            ttl: 7200,
            records: [{ content: "5.6.7.8", disabled: false }],
          },
        ],
      });
    }

    if (url === "/api/zones/zone-1" && method === "DELETE") {
      return createJsonResponse({ ok: true, zone: { id: "zone-1" } });
    }

    throw new Error(`Unhandled request: ${method} ${url}`);
  });
}

describe("App DNS flows", () => {
  it("error banner shows message, code and details separately", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/session") {
        return createJsonResponse({
          ok: true,
          currentUser: { id: "user-1", email: "admin@example.com", name: "Admin" },
          memberships: [
            {
              organizationId: "org-1",
              role: "admin",
              organizationName: "Org 1",
              organizationSlug: "org-1",
            },
          ],
          activeOrganization: { id: "org-1", name: "Org 1", slug: "org-1", role: "admin" },
        });
      }

      if (url === "/api/organizations") {
        return createJsonResponse({
          ok: true,
          organizations: [{ id: "org-1", name: "Org 1", slug: "org-1", createdAt: "now" }],
        });
      }

      if (url === "/api/organizations/org-1/members") {
        return createJsonResponse({ ok: true, members: [] });
      }

      if (url === "/api/invitations?organizationId=org-1") {
        return createJsonResponse({ ok: true, invitations: [] });
      }

      if (url === "/api/zones" && method === "GET") {
        return createJsonResponse(
          {
            ok: false,
            error: "PowerDNS API is not reachable",
            code: "POWERDNS_UNREACHABLE",
            details: { url: "http://powerdns.invalid", cause: "connect ECONNREFUSED" },
          },
          { ok: false, status: 503 },
        );
      }

      throw new Error(`Unhandled request: ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("PowerDNS API is not reachable")).toBeTruthy();
    expect(screen.getByText("Error code: POWERDNS_UNREACHABLE")).toBeTruthy();
    const detailsBlock = screen.getByText((_, element) => element?.tagName.toLowerCase() === "pre");
    expect(detailsBlock.textContent).toContain("http://powerdns.invalid");
    expect(detailsBlock.textContent).toContain("connect ECONNREFUSED");
  });

  it("admin sees Delete zone", async () => {
    vi.stubGlobal("fetch", createAdminFetchMock());

    render(<App />);

    expect(await screen.findByText("Delete zone")).toBeTruthy();
  });

  it("regular user does not see Delete zone", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/session") {
        return createJsonResponse({
          ok: true,
          currentUser: { id: "user-1", email: "user@example.com", name: "User" },
          memberships: [
            {
              organizationId: "org-1",
              role: "user",
              organizationName: "Org 1",
              organizationSlug: "org-1",
            },
          ],
          activeOrganization: { id: "org-1", name: "Org 1", slug: "org-1", role: "user" },
        });
      }

      if (url === "/api/organizations") {
        return createJsonResponse({
          ok: true,
          organizations: [{ id: "org-1", name: "Org 1", slug: "org-1", createdAt: "now" }],
        });
      }

      if (url === "/api/organizations/org-1/members") {
        return createJsonResponse({ ok: true, members: [] });
      }

      if (url === "/api/invitations?organizationId=org-1") {
        return createJsonResponse({ ok: true, invitations: [] });
      }

      if (url === "/api/zones" && method === "GET") {
        return createJsonResponse({
          ok: true,
          zones: [
            {
              id: "zone-1",
              organizationId: "org-1",
              name: "example.com.",
              provider: "powerdns",
              powerdnsZoneId: "pdns-zone-1",
              createdAt: "now",
            },
          ],
        });
      }

      if (url === "/api/zones/zone-1/records" && method === "GET") {
        return createJsonResponse({ ok: true, rrsets: [] });
      }

      throw new Error(`Unhandled request: ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByText("Read only");
    expect(screen.queryByText("Delete zone")).toBeNull();
  });

  it("record edit sends PATCH", async () => {
    const fetchMock = createAdminFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("www.example.com. A");
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const contentInput = screen.getByDisplayValue("1.2.3.4");
    await user.clear(contentInput);
    await user.type(contentInput, "5.6.7.8");

    const ttlInput = screen.getByDisplayValue("3600");
    await user.clear(ttlInput);
    await user.type(ttlInput, "7200");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/zones/zone-1/records",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("delete zone sends DELETE and reloads list", async () => {
    const fetchMock = createAdminFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Delete zone");
    const before = fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/zones" && (!init || init.method === undefined || init.method === "GET"),
    ).length;

    await user.click(screen.getByRole("button", { name: "Delete zone" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/zones/zone-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    await waitFor(() => {
      const after = fetchMock.mock.calls.filter(
        ([url, init]) => url === "/api/zones" && (!init || init.method === undefined || init.method === "GET"),
      ).length;
      expect(after).toBeGreaterThan(before);
    });
  });

  it("delete zone cancel does not send DELETE", async () => {
    const fetchMock = createAdminFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Delete zone");
    await user.click(screen.getByRole("button", { name: "Delete zone" }));

    await waitFor(() => {
      const deleteCalls = fetchMock.mock.calls.filter(
        ([url, init]) => url === "/api/zones/zone-1" && init?.method === "DELETE",
      );
      expect(deleteCalls).toHaveLength(0);
    });
  });
});
