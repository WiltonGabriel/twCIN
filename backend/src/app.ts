import type http from "node:http";
import type { DatabaseSync } from "node:sqlite";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyHttpOptions, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { EnvConfig } from "./config/env.js";
import { openDatabase } from "./db/connection.js";
import { runMigrations } from "./db/migrations.js";
import { seedInitialData } from "./db/seed.js";
import { registerAuditRoutes } from "./routes/audit.routes.js";
import { registerAuthRoutes } from "./routes/auth.routes.js";
import { registerBackupRoutes } from "./routes/backup.routes.js";
import { registerCatalogRoutes } from "./routes/catalogs.routes.js";
import { registerMovementRoutes } from "./routes/movements.routes.js";
import { registerSettingsRoutes } from "./routes/settings.routes.js";
import { registerSyncRoutes } from "./routes/sync.routes.js";
import { registerUserRoutes } from "./routes/users.routes.js";
import { createAuthGuard } from "./security/auth.js";
import { AppError } from "./services/errors.js";

export interface BuildAppOptions {
  env: EnvConfig;
  db?: DatabaseSync;
  globalRateLimitMax?: number;
  loginRateLimitMax?: number;
}

export async function buildApp(options: BuildAppOptions): Promise<{
  app: FastifyInstance;
  db: DatabaseSync;
}> {
  const { env } = options;
  const db = options.db ?? openDatabase(env.dbPath);

  runMigrations(db);
  seedInitialData(db, env);

  const serverOptions: FastifyHttpOptions<http.Server> = {
    logger: false,
    // Antes era sempre true: qualquer cliente podia forjar X-Forwarded-For, trocar o próprio IP
    // a cada tentativa e escapar do rate limit de login (e falsificar o IP gravado na auditoria).
    trustProxy: env.trustProxy ?? false
  };
  const app = Fastify(serverOptions);

  await app.register(helmet, {
    contentSecurityPolicy: false
  });

  await app.register(cors, {
    origin: env.corsOrigin.split(",").map((item) => item.trim()),
    credentials: true
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    max: options.globalRateLimitMax ?? 180,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Muitas requisições. Aguarde antes de tentar novamente."
    })
  });

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: err.issues[0]?.message || "Dados inválidos.",
        issues: err.issues
      });
    }

    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: err.message,
        ...(err.details ? { details: err.details } : {})
      });
    }

    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 429) {
      return reply.code(429).send({
        error: "Muitas requisições. Aguarde antes de tentar novamente."
      });
    }

    return reply.code(statusCode && statusCode >= 400 && statusCode < 500 ? statusCode : 500).send({
      error: statusCode && statusCode < 500 ? (err as Error).message : "Erro interno do servidor."
    });
  });

  const requireAuth = createAuthGuard(db, env.jwtSecret);
  const requireAuthPendingAllowed = createAuthGuard(db, env.jwtSecret, {
    allowPendingPasswordChange: true
  });

  app.get("/api/health", async () => ({ ok: true }));

  registerAuthRoutes(app, {
    db,
    jwtSecret: env.jwtSecret,
    cookieSecure: env.cookieSecure,
    loginRateLimitMax: options.loginRateLimitMax,
    requireAuthPendingAllowed
  });
  registerUserRoutes(app, db, requireAuth);
  registerMovementRoutes(app, db, requireAuth);
  registerCatalogRoutes(app, db, requireAuth);
  registerAuditRoutes(app, db, requireAuth);
  registerSettingsRoutes(app, db, requireAuth);
  registerSyncRoutes(app, db, requireAuth);
  registerBackupRoutes(app, db, requireAuth);

  app.addHook("onClose", async () => {
    db.close();
  });

  return { app, db };
}
