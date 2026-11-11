import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { LogController, type FastifyHttpOptions, type FastifyInstance } from "fastify";
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
  logger?: FastifyHttpOptions<http.Server>["logger"];
  disableRequestLogging?: boolean;
  globalRateLimitMax?: number;
  loginRateLimitMax?: number;
}

function resolveFrontendDir(env: EnvConfig): string {
  if (env.frontendDistDir) {
    return path.resolve(env.frontendDistDir);
  }
  const adjacentPublic = path.resolve(import.meta.dirname, "../public");
  if (fs.existsSync(path.join(adjacentPublic, "index.html"))) {
    return adjacentPublic;
  }
  return path.resolve(import.meta.dirname, "../../frontend/dist");
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
    logger: options.logger ?? false,
    ...(options.disableRequestLogging
      ? { logController: new LogController({ disableRequestLogging: true }) }
      : {}),
    bodyLimit: 3 * 1024 * 1024,
    // Antes era sempre true: qualquer cliente podia forjar X-Forwarded-For, trocar o próprio IP
    // a cada tentativa e escapar do rate limit de login (e falsificar o IP gravado na auditoria).
    trustProxy: env.trustProxy ?? false
  };
  const app = Fastify(serverOptions);

  await app.register(helmet, {
    contentSecurityPolicy: false
  });

  const configuredOrigins = env.corsOrigin
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  await app.register(cors, {
    delegator: (req, callback) => {
      const reqOrigin = req.headers.origin;
      if (!reqOrigin) {
        return callback(null, { origin: false, credentials: true });
      }
      if (configuredOrigins.includes(reqOrigin)) {
        return callback(null, { origin: true, credentials: true });
      }
      // Quando o próprio backend serve o frontend (Docker / Windows Server em rede local),
      // aceita chamadas da mesma origem/Host sem depender de pré-cadastrar o IP do servidor.
      if (env.serveFrontend) {
        try {
          const parsedOrigin = new URL(reqOrigin);
          const forwardedHost =
            env.trustProxy && req.headers["x-forwarded-host"]
              ? String(req.headers["x-forwarded-host"]).split(",")[0].trim()
              : undefined;
          const reqHost = (forwardedHost || req.headers.host || "").trim();
          if (reqHost && parsedOrigin.host.toLowerCase() === reqHost.toLowerCase()) {
            return callback(null, { origin: true, credentials: true });
          }
        } catch {
          // Ignora Origin inválido
        }
      }
      return callback(null, { origin: false, credentials: true });
    }
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

    const isClientError = Boolean(statusCode && statusCode >= 400 && statusCode < 500);
    if (!isClientError) {
      _request.log.error({ err }, "Erro interno na requisição");
    }

    return reply.code(isClientError ? (statusCode as number) : 500).send({
      error: isClientError ? (err as Error).message : "Erro interno do servidor."
    });
  });

  const requireAuth = createAuthGuard(db, env.jwtSecret);
  const requireAuthPendingAllowed = createAuthGuard(db, env.jwtSecret, {
    allowPendingPasswordChange: true
  });

  app.get("/api/health", async (_request, reply) => {
    try {
      db.prepare("SELECT 1 AS ok").get();
      return {
        ok: true,
        status: "ok",
        version: env.appVersion || "1.0.0",
        uptime_s: Math.floor(process.uptime())
      };
    } catch (err) {
      _request.log.error({ err }, "Falha no healthcheck do SQLite");
      return reply.code(503).send({ ok: false, status: "error", error: "Banco de dados indisponível." });
    }
  });

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

  if (env.serveFrontend) {
    registerStaticFrontend(app, resolveFrontendDir(env));
  }

  app.addHook("onClose", async () => {
    db.close();
  });

  return { app, db };
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

function registerStaticFrontend(app: FastifyInstance, distDir: string): void {
  const indexHtml = path.join(distDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    console.warn(`[twCIN] SERVE_FRONTEND=true, mas ${indexHtml} não existe. Rode \`npm run build\` antes.`);
    return;
  }

  app.setNotFoundHandler((request, reply) => {
    const reqPath = request.url.split("?")[0];
    if ((request.method !== "GET" && request.method !== "HEAD") || reqPath === "/api" || reqPath.startsWith("/api/")) {
      return reply.code(404).send({ error: "Rota não encontrada." });
    }

    let decoded = "/";
    try {
      decoded = decodeURIComponent(reqPath);
    } catch {
      return reply.code(400).send({ error: "Caminho inválido." });
    }

    const rel = decoded.replace(/^\/+/, "");
    const candidate = rel ? path.resolve(distDir, rel) : indexHtml;
    const isInside = candidate === distDir || candidate.startsWith(distDir + path.sep);
    if (!isInside) {
      return reply.code(403).send({ error: "Acesso negado." });
    }

    const filePath = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : indexHtml;
    const ext = path.extname(filePath).toLowerCase();
    const isHashedAsset = filePath.startsWith(path.join(distDir, "assets") + path.sep);
    reply
      .header("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream")
      .header("Cache-Control", isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache");
    return reply.send(fs.createReadStream(filePath));
  });
}
