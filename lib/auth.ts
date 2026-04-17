import { randomBytes } from "node:crypto";
import { getPool } from "./database.js";
import { createActiveOrganizationCookie, createSessionCookie } from "./request-context.js";

const LOGIN_TOKEN_LIFETIME_MINUTES = 20;
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30;

export class AuthFlowError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AuthFlowError";
    this.code = code;
    this.details = details;
  }
}

export function createExpiredCookie(name: string, httpOnly = true) {
  const flags = ["Path=/", "Secure", "SameSite=Lax", "Max-Age=0"];

  if (httpOnly) {
    flags.splice(1, 0, "HttpOnly");
  }

  return `${name}=; ${flags.join("; ")}`;
}

export function createLogoutCookies() {
  return [createExpiredCookie("app_session"), createExpiredCookie("active_organization_id", false)];
}

function getAppBaseUrl() {
  const appUrl = process.env.APP_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;

  if (!appUrl) {
    throw new Error("APP_URL is not set");
  }

  return appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
}

export async function createLoginToken(input: {
  email: string;
  name?: string;
  inviteOrganizationId?: string | null;
}) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + LOGIN_TOKEN_LIFETIME_MINUTES * 60 * 1000);

  await getPool().query(
    `insert into login_tokens (email, name, token, invite_organization_id, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [
      input.email.toLowerCase(),
      input.name?.trim() || null,
      token,
      input.inviteOrganizationId ?? null,
      expiresAt,
    ],
  );

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    loginUrl: `${getAppBaseUrl().replace(/\/$/, "")}/api/auth/verify?token=${token}`,
  };
}

export async function consumeLoginToken(token: string) {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    const tokenResult = await client.query(
      `delete from login_tokens
       where token = $1 and expires_at > now()
       returning email, name, invite_organization_id as "inviteOrganizationId"`,
      [token],
    );

    const loginToken = tokenResult.rows[0] as
      | { email: string; name: string | null; inviteOrganizationId: string | null }
      | undefined;

    if (!loginToken) {
      await client.query("rollback");
      throw new AuthFlowError("TOKEN_INVALID_OR_EXPIRED", "Login link is invalid or expired");
    }

    let userResult;

    try {
      userResult = await client.query(
        `insert into users (email, name)
         values ($1, $2)
         on conflict (email)
         do update set name = coalesce(users.name, excluded.name)
         returning id, email, name`,
        [loginToken.email.toLowerCase(), loginToken.name?.trim() || loginToken.email.split("@")[0]],
      );
    } catch (error) {
      throw new AuthFlowError(
        "USER_UPSERT_FAILED",
        "Failed to create or load user during sign in",
        error,
      );
    }

    const user = userResult.rows[0] as { id: string; email: string; name: string };
    const sessionToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_SECONDS * 1000).toISOString();

    try {
      await client.query(
        `insert into user_sessions (session_token, user_id, expires_at)
         values ($1, $2, $3)`,
        [sessionToken, user.id, expiresAt],
      );
    } catch (error) {
      throw new AuthFlowError("SESSION_CREATE_FAILED", "Failed to create user session", error);
    }

    await client.query("commit");

    return {
      user,
      sessionToken,
      inviteOrganizationId: loginToken.inviteOrganizationId,
    };
  } catch (error) {
    await client.query("rollback");
    if (error instanceof AuthFlowError) {
      throw error;
    }

    throw new AuthFlowError("VERIFY_FLOW_FAILED", "Unhandled verify flow failure", error);
  } finally {
    client.release();
  }
}

export async function deleteSession(sessionToken: string) {
  await getPool().query("delete from user_sessions where session_token = $1", [sessionToken]);
}

export function createLoginSuccessCookies(input: {
  sessionToken: string;
  activeOrganizationId?: string | null;
}) {
  const cookies = [
    createSessionCookie("app_session", input.sessionToken, SESSION_LIFETIME_SECONDS),
  ];

  if (input.activeOrganizationId) {
    cookies.push(
      createActiveOrganizationCookie(input.activeOrganizationId, SESSION_LIFETIME_SECONDS),
    );
  }

  return cookies;
}
