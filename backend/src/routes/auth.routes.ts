import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { withTransaction } from "../db/connection.js";
import { changePasswordSchema, loginSchema, setupSchema } from "../schemas/index.js";
import { writeAuditLog } from "../security/audit.js";
import {
  clearSessionCookie,
  revokeSession,
  setSessionCookie,
  signSessionToken,
  type AuthUser
} from "../security/auth.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import { ConflictError } from "../services/errors.js";

export interface AuthRouteDeps {
  db: DatabaseSync;
  jwtSecret: string;
  cookieSecure: boolean;
  loginRateLimitMax?: number;
  requireAuthPendingAllowed: (req: any, reply: any) => Promise<void>;
}

const DUMMY_PASSWORD_HASH = hashPassword(crypto.randomUUID());

function toPublicAuthUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    must_change_password: user.must_change_password,
    last_login_at: user.last_login_at
  };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const { db, jwtSecret, cookieSecure, requireAuthPendingAllowed } = deps;

  app.get("/api/auth/status", async () => {
    const row = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
    return { needs_setup: row.count === 0 };
  });

  app.post(
    "/api/auth/setup",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute"
        }
      }
    },
    async (request, reply) => {
      const parsed = setupSchema.parse(request.body);
      const now = new Date().toISOString();
      const normalizedUsername = parsed.username.toLowerCase();

      const createdUser = withTransaction(db, () => {
        const countRow = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
        if (countRow.count > 0) {
          throw new ConflictError("A configuração inicial já foi realizada.");
        }

        const info = db.prepare(`
          INSERT INTO users (
            full_name, username, password_hash, active, must_change_password, token_version, last_login_at, password_changed_at, created_at, updated_at
          ) VALUES (?, ?, ?, 1, 0, 1, ?, ?, ?, ?)
        `).run(parsed.full_name.trim(), normalizedUsername, hashPassword(parsed.password), now, now, now, now);

        const upsertSetting = db.prepare(`
          INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `);
        if (parsed.app_name) {
          upsertSetting.run("app_name", parsed.app_name.trim(), now);
        }
        if (parsed.org_name) {
          upsertSetting.run("org_name", parsed.org_name.trim(), now);
        }

        const userId = Number(info.lastInsertRowid);
        writeAuditLog(db, {
          userId,
          userName: parsed.full_name.trim(),
          action: "CREATE",
          entity: "user",
          entityId: userId,
          summary: `Usuário inicial criado no setup: ${parsed.full_name.trim()} (@${normalizedUsername})`,
          ipAddress: request.ip
        });

        return {
          id: userId,
          username: normalizedUsername,
          full_name: parsed.full_name.trim(),
          must_change_password: false,
          last_login_at: now,
          token_version: 1
        } satisfies AuthUser;
      });

      const token = await signSessionToken(createdUser, jwtSecret);
      setSessionCookie(reply, token, cookieSecure);

      return reply.code(201).send({ user: toPublicAuthUser(createdUser) });
    }
  );

  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: {
          max: deps.loginRateLimitMax ?? 8,
          timeWindow: "1 minute"
        }
      }
    },
    async (request, reply) => {
      const parsed = loginSchema.parse(request.body);
      const username = parsed.username.toLowerCase();
      const row = db
        .prepare(`
          SELECT id, full_name, username, password_hash, active, must_change_password, token_version, last_login_at
          FROM users WHERE LOWER(username) = ?
        `)
        .get(username) as
        | {
            id: number;
            full_name: string;
            username: string;
            password_hash: string;
            active: number;
            must_change_password: number;
            token_version: number;
            last_login_at: string | null;
          }
        | undefined;

      // Sempre calcula o scrypt, mesmo sem usuário, para o tempo de resposta não revelar se ele existe.
      const passwordOk = verifyPassword(parsed.password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
      if (!row || row.active !== 1 || !passwordOk) {
        writeAuditLog(db, {
          userId: row?.id ?? null,
          userName: row?.full_name || username,
          action: "LOGIN_FAILED",
          entity: "auth",
          summary: `Tentativa de login falhou para @${username}`,
          ipAddress: request.ip
        });
        return reply.code(401).send({ error: "Usuário ou senha inválidos." });
      }

      const now = new Date().toISOString();
      withTransaction(db, () => {
        db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(
          now,
          now,
          row.id
        );
        writeAuditLog(db, {
          userId: row.id,
          userName: row.full_name,
          action: "LOGIN",
          entity: "auth",
          entityId: row.id,
          summary: `Login efetuado por ${row.full_name}`,
          ipAddress: request.ip
        });
      });

      const authUser: AuthUser = {
        id: row.id,
        username: row.username,
        full_name: row.full_name,
        must_change_password: row.must_change_password === 1,
        last_login_at: now,
        token_version: row.token_version
      };

      const token = await signSessionToken(authUser, jwtSecret);
      setSessionCookie(reply, token, cookieSecure);

      return { user: toPublicAuthUser(authUser) };
    }
  );

  app.post(
    "/api/auth/change-password",
    {
      preHandler: [requireAuthPendingAllowed],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute"
        }
      }
    },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      const parsed = changePasswordSchema.parse(request.body);

      const dbRow = db
        .prepare("SELECT password_hash, token_version, must_change_password FROM users WHERE id = ?")
        .get(currentUser.id) as
        | { password_hash: string; token_version: number; must_change_password: number }
        | undefined;

      if (!dbRow || !verifyPassword(parsed.current_password, dbRow.password_hash)) {
        return reply.code(400).send({ error: "A senha atual está incorreta." });
      }

      if (parsed.current_password === parsed.new_password) {
        return reply.code(400).send({ error: "A nova senha deve ser diferente da senha atual." });
      }

      const now = new Date().toISOString();
      const nextTokenVersion = dbRow.token_version + 1;

      withTransaction(db, () => {
        db.prepare(`
          UPDATE users SET
            password_hash = ?,
            must_change_password = 0,
            token_version = ?,
            password_changed_at = ?,
            updated_at = ?
          WHERE id = ?
        `).run(hashPassword(parsed.new_password), nextTokenVersion, now, now, currentUser.id);

        writeAuditLog(db, {
          userId: currentUser.id,
          userName: currentUser.full_name,
          action: "PASSWORD_CHANGE",
          entity: "user",
          entityId: currentUser.id,
          summary:
            dbRow.must_change_password === 1
              ? `Troca obrigatória de senha no primeiro acesso concluída por ${currentUser.full_name}`
              : `Senha alterada por ${currentUser.full_name}`,
          ipAddress: request.ip
        });
      });

      const updatedUser: AuthUser = {
        ...currentUser,
        must_change_password: false,
        token_version: nextTokenVersion
      };

      const freshToken = await signSessionToken(updatedUser, jwtSecret);
      setSessionCookie(reply, freshToken, cookieSecure);

      return { user: toPublicAuthUser(updatedUser) };
    }
  );

  app.post("/api/auth/logout", { preHandler: [requireAuthPendingAllowed] }, async (request, reply) => {
    const user = request.currentUser!;
    // Antes o logout só apagava o cookie: uma cópia do token continuava válida por 7 dias.
    if (request.currentSession?.jti) {
      revokeSession(db, request.currentSession.jti, request.currentSession.exp);
    }
    clearSessionCookie(reply, cookieSecure);
    writeAuditLog(db, {
      userId: user.id,
      userName: user.full_name,
      action: "LOGOUT",
      entity: "auth",
      entityId: user.id,
      summary: `Logout efetuado por ${user.full_name}`,
      ipAddress: request.ip
    });
    return { ok: true };
  });

  app.post("/api/auth/logout-all", { preHandler: [requireAuthPendingAllowed] }, async (request, reply) => {
    const user = request.currentUser!;
    withTransaction(db, () => {
      db.prepare("UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        user.id
      );
      writeAuditLog(db, {
        userId: user.id,
        userName: user.full_name,
        action: "SESSION_REVOKED",
        entity: "user",
        entityId: user.id,
        summary: `${user.full_name} encerrou as sessões em todos os dispositivos`,
        ipAddress: request.ip
      });
    });
    clearSessionCookie(reply, cookieSecure);
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: [requireAuthPendingAllowed] }, async (request) => {
    return { user: toPublicAuthUser(request.currentUser!) };
  });
}
