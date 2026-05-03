import { describe, expect, it, vi } from "vitest";
import { requestJson } from "./api-client";

function createJsonResponse(body: unknown, init: { ok: boolean; status: number }) {
  const jsonText = JSON.stringify(body);

  return {
    ok: init.ok,
    status: init.status,
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
  } as unknown as Response;
}

function createTextResponse(text: string, init: { ok: boolean; status: number }) {
  return {
    ok: init.ok,
    status: init.status,
    headers: {
      get() {
        return "text/plain";
      },
    },
    async json() {
      throw new Error("not json");
    },
    async text() {
      return text;
    },
  } as unknown as Response;
}

describe("requestJson", () => {
  it("returns parsed JSON for successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(createJsonResponse({ ok: true, value: 42 }, { ok: true, status: 200 })),
    );

    await expect(requestJson<{ ok: boolean; value: number }>("/api/test")).resolves.toEqual({
      ok: true,
      value: 42,
    });
  });

  it("throws message from HTTP JSON error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createJsonResponse({ ok: false, error: "Zone not found" }, { ok: false, status: 404 }),
      ),
    );

    await expect(requestJson("/api/test")).rejects.toMatchObject({
      message: "Zone not found",
      status: 404,
    });
  });

  it("preserves error code from backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createJsonResponse(
          { ok: false, error: "PowerDNS error", code: "POWERDNS_UNREACHABLE" },
          { ok: false, status: 503 },
        ),
      ),
    );

    await expect(requestJson("/api/test")).rejects.toMatchObject({
      message: "PowerDNS error",
      code: "POWERDNS_UNREACHABLE",
      status: 503,
    });
  });

  it("preserves error details from backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createJsonResponse(
          {
            ok: false,
            error: "Provider failed",
            details: { upstreamStatus: 502, reason: "timeout" },
          },
          { ok: false, status: 502 },
        ),
      ),
    );

    await expect(requestJson("/api/test")).rejects.toMatchObject({
      message: "Provider failed",
      details: { upstreamStatus: 502, reason: "timeout" },
      status: 502,
    });
  });

  it("falls back when backend does not return JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(createTextResponse("Internal server error", { ok: false, status: 500 })),
    );

    await expect(requestJson("/api/test")).rejects.toThrow(
      "Expected JSON but received: Internal server error",
    );
  });
});
