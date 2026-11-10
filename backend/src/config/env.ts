import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface EnvConfig {
  port: number;
  host: string;
  corsOrigin: string;
  cookieSecure: boolean;
  /**
   * Repassado ao Fastify. false (padrão) ignora X-Forwarded-For; só habilite quando o backend
   * estiver atrás de um proxy reverso confiável, informando true ou o IP/CIDR do proxy.
   */
  trustProxy?: boolean | string;
  jwtSecret: string;
  dbPath: string;
  seedAdminName?: string;
  seedAdminUsername?: string;
  seedAdminPassword?: string;
}

function resolveJwtSecret(dbPath: string): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) {
    return fromEnv;
  }

  if (dbPath === ":memory:") {
    return crypto.randomBytes(32).toString("hex");
  }

  const secretFile = path.join(path.dirname(path.resolve(dbPath)), ".jwt_secret");
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  if (fs.existsSync(secretFile)) {
    const existing = fs.readFileSync(secretFile, "utf8").trim();
    if (existing.length >= 32) {
      return existing;
    }
  }

  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretFile, generated, { encoding: "utf8", mode: 0o600 });
  return generated;
}

export function parseTrustProxy(raw: string | undefined): boolean | string {
  const value = raw?.trim();
  if (!value || value.toLowerCase() === "false") return false;
  if (value.toLowerCase() === "true") return true;
  return value;
}

export function loadEnv(): EnvConfig {
  const envFile = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envFile);
  }

  const dbPath = process.env.DB_PATH?.trim() || "./data/twcin.db";
  const port = Number(process.env.PORT || 3333);
  const host = process.env.HOST?.trim() || "0.0.0.0";
  const corsOrigin = process.env.CORS_ORIGIN?.trim() || "http://localhost:5173";
  const cookieSecure = process.env.COOKIE_SECURE === "true";
  if (process.env.NODE_ENV === "production" && !cookieSecure) {
    console.warn(
      "[twCIN] AVISO: NODE_ENV=production com COOKIE_SECURE=false. Em produção, sirva o sistema por HTTPS e defina COOKIE_SECURE=true."
    );
  }
  if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET?.trim()) {
    console.warn("[twCIN] AVISO: JWT_SECRET não definido; usando chave gerada em arquivo local (backend/data/.jwt_secret).");
  }

  return {
    port: Number.isFinite(port) ? port : 3333,
    host,
    corsOrigin,
    cookieSecure,
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    jwtSecret: resolveJwtSecret(dbPath),
    dbPath,
    seedAdminName: process.env.SEED_ADMIN_NAME?.trim() || undefined,
    seedAdminUsername: process.env.SEED_ADMIN_USERNAME?.trim() || undefined,
    seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || undefined
  };
}
