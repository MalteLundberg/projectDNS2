import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import healthHandler from "../api/health";
import dbCheckHandler from "../api/db-check";
import invitationsHandler from "../api/invitations/index";
import acceptInvitationHandler from "../api/invitations/[id]/accept";
import revokeInvitationHandler from "../api/invitations/[id]/revoke";
import organizationMembersHandler from "../api/organizations/[id]/members";
import organizationsHandler from "../api/organizations/index";
import sessionHandler from "../api/session";
import activeOrganizationHandler from "../api/session/active-organization";
import zonesHandler from "../api/zones/index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

type JsonResponse = {
  statusCode: number;
  payload: unknown;
  headers?: Record<string, string | string[]>;
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
