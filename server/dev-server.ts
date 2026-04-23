import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import healthHandler from "./routes/health.js";
import dbCheckHandler from "./routes/db-check.js";
import authLoginHandler from "./routes/auth/login.js";
import authLogoutHandler from "./routes/auth/logout.js";
import authPasswordLoginHandler from "./routes/auth/password-login.js";
import authVerifyHandler from "./routes/auth/verify.js";
import invitationsHandler from "./routes/invitations/index.js";
import acceptInvitationHandler from "./routes/invitations/[id]/accept.js";
import revokeInvitationHandler from "./routes/invitations/[id]/revoke.js";
import onboardingHandler from "./routes/onboarding.js";
import organizationMembersHandler from "./routes/organizations/[id]/members.js";
import organizationsHandler from "./routes/organizations/index.js";
import sessionHandler from "./routes/session.js";
import activeOrganizationHandler from "./routes/session/active-organization.js";
import zoneRecordsHandler from "./routes/zones/[id]/records.js";
import zonesHandler from "./routes/zones/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

type JsonResponse = {
  statusCode: number;
  payload: unknown;
  headers?: Record<string, string | string[]>;
  redirectLocation?: string;
};

type MockRequest = {
  method: string;
  query: Record<string, string | string[]>;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
};

type LocalHandler = (
  req: MockRequest,
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (name: string, value: string | string[]) => void;
    writeHead: (statusCode: number, headers: Record<string, string>) => void;
    end: (body?: string) => void;
  },
) => void | Promise<void>;

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function parseBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function runHandler(handler: LocalHandler, req: MockRequest): Promise<JsonResponse> {
  const response: JsonResponse = { statusCode: 200, payload: {} };

  await handler(req, {
    status(code: number) {
      response.statusCode = code;

      return {
        json(body: unknown) {
          response.payload = body;
        },
      };
    },
    setHeader(name: string, value: string | string[]) {
      response.headers ??= {};
      response.headers[name] = value;
    },
    writeHead(statusCode: number, headers: Record<string, string>) {
      response.statusCode = statusCode;
      response.headers ??= {};
      Object.assign(response.headers, headers);
      if (headers.Location) {
        response.redirectLocation = headers.Location;
      }
    },
    end(body?: string) {
      response.payload = body ?? response.payload;
    },
  });

  return response;
}

function getHeaders(req: http.IncomingMessage) {
  const devSessionCookie = process.env.DEV_SESSION_COOKIE;

  return {
    cookie: req.headers.cookie ?? devSessionCookie,
  };
}

function getContentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";

  return "application/octet-stream";
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1:3000");
  const pathname = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams.entries());
  const method = req.method ?? "GET";
  const headers = getHeaders(req);

  if (pathname === "/api/health") {
    const response = await runHandler(healthHandler as unknown as LocalHandler, {
      method,
      query,
      headers,
    });
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  if (pathname === "/api/db-check") {
    const response = await runHandler(dbCheckHandler as unknown as LocalHandler, {
      method,
      query,
      headers,
    });
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  if (pathname === "/api/session") {
    const response = await runHandler(sessionHandler as unknown as LocalHandler, {
      method,
      query,
      headers,
    });
    if (response.headers) {
      for (const [name, value] of Object.entries(response.headers)) {
        res.setHeader(name, value);
      }
    }
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  if (pathname === "/api/auth/login") {
    const response = await runHandler(authLoginHandler as unknown as LocalHandler, {
      method,
      query,
      headers,
      body: method === "POST" ? await parseBody(req) : undefined,
    });
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  if (pathname === "/api/auth/password-login") {
    const response = await runHandler(authPasswordLoginHandler as unknown as LocalHandler, {
      method,
      query,
      headers,
      body: method === "POST" ? await parseBody(req) : undefined,
    });
    if (response.headers) {
      for (const [name, value] of Object.entries(response.headers)) {
        res.setHeader(name, value);
      }
    }
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  if (pathname === "/api/auth/logout") {
    const response = await runHandler(authLogoutHandler as unknown as LocalHandler, {
      method,
      query,
      headers,
      body: method === "POST" ? await parseBody(req) : undefined,
    });
    if (response.headers) {
      for (const [name, value] of Object.entries(response.headers)) {
        res.setHeader(name, value);
      }
    }
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  if (pathname === "/api/auth/verify") {
    const response = await runHandler(authVerifyHandler as unknown as LocalHandler, {
      method,
      query,
      headers,
    });
    if (response.headers) {
      for (const [name, value] of Object.entries(response.headers)) {
        res.setHeader(name, value);
      }
    }
    if (response.statusCode === 302) {
      res.writeHead(302, {
        Location: typeof response.headers?.Location === "string" ? response.headers.Location : "/",
      });
      res.end();
      return;
    }
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  if (pathname === "/api/session/active-organization") {
    const response = await runHandler(activeOrganizationHandler as unknown as LocalHandler, {
      method,
      query,
      headers,
      body: method === "POST" ? await parseBody(req) : undefined,
    });
    if (response.headers) {
      for (const [name, value] of Object.entries(response.headers)) {
        res.setHeader(name, value);
      }
    }
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  if (pathname === "/api/organizations") {
    const response = await runHandler(organizationsHandler as unknown as LocalHandler, {
      method,
      query,
      headers,
      body: method === "POST" ? await parseBody(req) : undefined,
    });
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  if (pathname === "/api/onboarding") {
    const response = await runHandler(onboardingHandler as unknown as LocalHandler, {
      method,
      query,
      headers,
      body: method === "POST" ? await parseBody(req) : undefined,
    });
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  const organizationMembersMatch = pathname.match(/^\/api\/organizations\/([^/]+)\/members$/);

  if (organizationMembersMatch) {
    const response = await runHandler(organizationMembersHandler as unknown as LocalHandler, {
      method,
      headers,
      query: {
        ...query,
        id: organizationMembersMatch[1],
      },
    });
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  if (pathname === "/api/invitations") {
    const response = await runHandler(invitationsHandler as unknown as LocalHandler, {
      method,
      query,
      headers,
      body: method === "POST" ? await parseBody(req) : undefined,
    });
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  if (pathname === "/api/zones") {
    const response = await runHandler(zonesHandler as unknown as LocalHandler, {
      method,
      query,
      headers,
      body: method === "POST" ? await parseBody(req) : undefined,
    });
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  const zoneRecordsMatch = pathname.match(/^\/api\/zones\/([^/]+)\/records$/);

  if (zoneRecordsMatch) {
    const response = await runHandler(zoneRecordsHandler as unknown as LocalHandler, {
      method,
      query: {
        ...query,
        id: zoneRecordsMatch[1],
      },
      headers,
      body: method === "POST" ? await parseBody(req) : undefined,
    });
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  const revokeInvitationMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/revoke$/);

  if (revokeInvitationMatch) {
    const response = await runHandler(revokeInvitationHandler as unknown as LocalHandler, {
      method,
      query: {
        ...query,
        id: revokeInvitationMatch[1],
      },
      headers,
      body: method === "POST" ? await parseBody(req) : undefined,
    });
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  const acceptInvitationMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/accept$/);

  if (acceptInvitationMatch) {
    const response = await runHandler(acceptInvitationHandler as unknown as LocalHandler, {
      method,
      query: {
        ...query,
        id: acceptInvitationMatch[1],
      },
      headers,
      body: method === "POST" ? await parseBody(req) : undefined,
    });
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.join(distDir, relativePath);
  const safePath = path.normalize(filePath);

  if (!safePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const fallbackPath = path.join(distDir, "index.html");
  const targetPath = existsSync(safePath) ? safePath : fallbackPath;

  try {
    const fileStat = await stat(targetPath);

    if (!fileStat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "content-type": getContentType(targetPath) });
    createReadStream(targetPath).pipe(res);
  } catch {
    res.writeHead(500);
    res.end("Server error");
  }
});

server.listen(3000, "127.0.0.1", () => {
  console.log("Local app available at http://127.0.0.1:3000");
});
