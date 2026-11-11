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
  backupDir?: string;
  autoBackupHours?: number;
  autoBackupRetain?: number;
  logLevel?: string;
  appVersion?: string;
  seedAdminName?: string;
  seedAdminUsername?: string;
  seedAdminPassword?: string;
  serveFrontend?: boolean;
  frontendDistDir?: string;
  envFilePath?: string;
  portAutoFallback?: boolean;
}

const backendRoot = path.resolve(import.meta.dirname, "../..");

function readAppVersion(): string {
  for (const candidate of [
    path.resolve(backendRoot, "package.json"),
    path.resolve(backendRoot, "../package.json")
  ]) {
    try {
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: unknown };
        if (typeof parsed.version === "string" && parsed.version.trim()) {
          return parsed.version.trim();
        }
      }
    } catch {
      // ignora erro de leitura opcional
    }
  }
  return "1.0.0";
}

function resolveEnvFile(): string | undefined {
  const explicit = process.env.ENV_FILE?.trim();
  const candidates = [
    ...(explicit ? [path.resolve(explicit)] : []),
    path.resolve(process.cwd(), ".env"),
    path.resolve(backendRoot, ".env")
  ];
  return candidates.find((file) => fs.existsSync(file));
}

function resolvePathAgainstRoot(raw: string, baseDir: string): string {
  return path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
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

function parseNonNegativeInt(raw: string | undefined, fallback: number, max = 1000): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(max, Math.floor(n));
}

export function loadEnv(): EnvConfig {
  const envFile = resolveEnvFile();
  if (envFile && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envFile);
  }

  const isProd = process.env.NODE_ENV === "production";
  const dataDirRaw = process.env.DATA_DIR?.trim();
  const dataDir = dataDirRaw ? resolvePathAgainstRoot(dataDirRaw, backendRoot) : undefined;

  const rawDbPath = process.env.DB_PATH?.trim();
  const dbPath =
    rawDbPath === ":memory:"
      ? ":memory:"
      : rawDbPath
        ? resolvePathAgainstRoot(rawDbPath, dataDir ?? backendRoot)
        : path.join(dataDir ?? path.join(backendRoot, "data"), "twcin.db");

  const rawBackupDir = process.env.BACKUP_DIR?.trim();
  const backupDir =
    dbPath === ":memory:"
      ? undefined
      : rawBackupDir
        ? resolvePathAgainstRoot(rawBackupDir, dataDir ?? backendRoot)
        : path.join(path.dirname(dbPath), "backups");

  const port = Number(process.env.PORT || 3333);
  const host = process.env.HOST?.trim() || "0.0.0.0";
  const corsOrigin = process.env.CORS_ORIGIN?.trim() || "http://localhost:5173";
  const cookieSecure = process.env.COOKIE_SECURE === "true";

  if (isProd && !cookieSecure) {
    console.warn(
      "[twCIN] AVISO: NODE_ENV=production com COOKIE_SECURE=false. Se publicar com HTTPS via proxy reverso, defina COOKIE_SECURE=true."
    );
  }
  if (isProd && !process.env.JWT_SECRET?.trim()) {
    console.info("[twCIN] Usando chave JWT automática persistida junto ao diretório de dados (.jwt_secret).");
  }

  return {
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 3333,
    host,
    corsOrigin,
    cookieSecure,
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    jwtSecret: resolveJwtSecret(dbPath),
    dbPath,
    backupDir,
    autoBackupHours: parseNonNegativeInt(process.env.AUTO_BACKUP_HOURS, isProd ? 24 : 0, 720),
    autoBackupRetain: Math.max(1, parseNonNegativeInt(process.env.AUTO_BACKUP_RETAIN, 14, 365)),
    logLevel: process.env.LOG_LEVEL?.trim() || (isProd ? "info" : "warn"),
    appVersion: readAppVersion(),
    seedAdminName: process.env.SEED_ADMIN_NAME?.trim() || undefined,
    seedAdminUsername: process.env.SEED_ADMIN_USERNAME?.trim() || undefined,
    seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || undefined,
    serveFrontend: process.env.SERVE_FRONTEND === "true",
    frontendDistDir: process.env.FRONTEND_DIST_DIR?.trim()
      ? resolvePathAgainstRoot(process.env.FRONTEND_DIST_DIR.trim(), backendRoot)
      : undefined,
    envFilePath: envFile,
    portAutoFallback: process.env.PORT_AUTO_FALLBACK === "true"
  };
}
