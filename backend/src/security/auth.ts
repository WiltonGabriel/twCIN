import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE_NAME = "twcin_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  must_change_password: boolean;
  last_login_at: string | null;
  token_version: number;
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: AuthUser;
    currentSession?: { jti: string | null; exp: number | null };
  }
}

export async function signSessionToken(
  user: Pick<AuthUser, "id" | "username" | "full_name" | "token_version">,
  secret: string
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({
    sub: String(user.id),
    username: user.username,
    full_name: user.full_name,
    tv: user.token_version
  })
    .setProtectedHeader({ alg: "HS256" })
    // jti identifica esta sessão para que o logout possa invalidá-la sozinha.
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifySessionToken(
  token: string,
  secret: string
): Promise<{ id: number; token_version: number; jti: string | null; exp: number | null } | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    const id = Number(payload.sub);
    const tokenVersion = Number(payload.tv ?? 1);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(tokenVersion)) {
      return null;
    }
    return {
      id,
      token_version: tokenVersion,
      jti: typeof payload.jti === "string" ? payload.jti : null,
      exp: typeof payload.exp === "number" ? payload.exp : null
    };
  } catch {
    return null;
  }
}

/** Invalida uma sessão específica (logout deste dispositivo). */
export function revokeSession(db: DatabaseSync, jti: string, exp: number | null): void {
  const expiresAt = new Date((exp ?? Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS) * 1000).toISOString();
  db.prepare("INSERT OR IGNORE INTO revoked_sessions (jti, expires_at) VALUES (?, ?)").run(jti, expiresAt);
  // Limpeza oportunista: sessões revogadas que já expiraram não precisam mais ser guardadas.
  db.prepare("DELETE FROM revoked_sessions WHERE expires_at < ?").run(new Date().toISOString());
}

function isSessionRevoked(db: DatabaseSync, jti: string | null): boolean {
  if (!jti) return false;
  return Boolean(db.prepare("SELECT 1 FROM revoked_sessions WHERE jti = ?").get(jti));
}

export function setSessionCookie(reply: FastifyReply, token: string, cookieSecure: boolean): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export function clearSessionCookie(reply: FastifyReply, cookieSecure: boolean): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/"
  });
}

export function createAuthGuard(
  db: DatabaseSync,
  secret: string,
  options?: { allowPendingPasswordChange?: boolean }
) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) {
      reply.code(401).send({ error: "Sessão expirada ou não autenticada." });
      return;
    }

    const decoded = await verifySessionToken(token, secret);
    if (!decoded || isSessionRevoked(db, decoded.jti)) {
      reply.code(401).send({ error: "Sessão inválida." });
      return;
    }

    const dbUser = db
      .prepare(`
        SELECT id, username, full_name, active, must_change_password, token_version, last_login_at
        FROM users WHERE id = ?
      `)
      .get(decoded.id) as
      | {
          id: number;
          username: string;
          full_name: string;
          active: number;
          must_change_password: number;
          token_version: number;
          last_login_at: string | null;
        }
      | undefined;

    if (!dbUser || dbUser.active !== 1 || dbUser.token_version !== decoded.token_version) {
      reply.code(401).send({ error: "Sessão inválida ou usuário inativo." });
      return;
    }

    if (dbUser.must_change_password === 1 && !options?.allowPendingPasswordChange) {
      reply.code(403).send({
        error: "É obrigatório definir uma nova senha antes de acessar o sistema.",
        code: "PASSWORD_CHANGE_REQUIRED"
      });
      return;
    }

    request.currentSession = { jti: decoded.jti, exp: decoded.exp };
    request.currentUser = {
      id: dbUser.id,
      username: dbUser.username,
      full_name: dbUser.full_name,
      must_change_password: dbUser.must_change_password === 1,
      last_login_at: dbUser.last_login_at,
      token_version: dbUser.token_version
    };
  };
}
