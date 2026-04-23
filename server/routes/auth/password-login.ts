import { timingSafeEqual, scryptSync } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  AuthFlowError,
  createLoginSuccessCookies,
  createUserSession,
  getDefaultActiveOrganizationId,
} from "../../../lib/auth.js";

export const config = {
  runtime: "nodejs",
};

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

function parsePasswordHash(hashValue: string) {
  const [algorithm, salt, derivedKey] = hashValue.split(":");

  if (algorithm !== "scrypt" || !salt || !derivedKey) {
    throw new Error("SUPERVISOR_LOGIN_PASSWORD_HASH must use format scrypt:salt:hash");
  }

  return {
    salt,
    derivedKey: Buffer.from(derivedKey, "hex"),
  };
}

function verifyPassword(password: string, hashValue: string) {
  const { salt, derivedKey } = parsePasswordHash(hashValue);
  const candidate = scryptSync(password, salt, derivedKey.length);

  return timingSafeEqual(candidate, derivedKey);
}

function createInvalidLoginError() {
  return new AuthFlowError("INVALID_SUPERVISOR_LOGIN", "Invalid username or password");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const { username, password } = req.body ?? {};
    const normalizedUsername = String(username ?? "").trim();
    const normalizedPassword = String(password ?? "");

    if (!normalizedUsername || !normalizedPassword) {
      res.status(400).json({ ok: false, error: "username and password are required" });
      return;
    }

    const expectedUsername = getRequiredEnv("SUPERVISOR_LOGIN_USERNAME");
    const passwordHash = getRequiredEnv("SUPERVISOR_LOGIN_PASSWORD_HASH");

    if (normalizedUsername !== expectedUsername || !verifyPassword(normalizedPassword, passwordHash)) {
      throw createInvalidLoginError();
    }

    const session = await createUserSession({
      email: getRequiredEnv("SUPERVISOR_LOGIN_EMAIL"),
      name: getRequiredEnv("SUPERVISOR_LOGIN_NAME"),
    });
    const activeOrganizationId = await getDefaultActiveOrganizationId(session.user.id);

    res.setHeader(
      "Set-Cookie",
      createLoginSuccessCookies({
        sessionToken: session.sessionToken,
        activeOrganizationId,
      }),
    );
    res.status(200).json({
      ok: true,
      currentUser: session.user,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown password login error";
    const isInvalidLogin = error instanceof AuthFlowError && error.code === "INVALID_SUPERVISOR_LOGIN";

    console.error("api/auth/password-login failed", {
      method: req.method,
      body: req.body ? { username: req.body.username } : undefined,
      error,
    });

    res.status(isInvalidLogin ? 401 : 500).json({ ok: false, error: message });
  }
}
