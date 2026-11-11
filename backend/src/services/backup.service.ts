import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { withTransaction } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { writeAuditLog } from "../security/audit.js";
import type { AuthUser } from "../security/auth.js";
import { BadRequestError } from "./errors.js";

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "utf8");

const RESTORE_DELETE_ORDER = [
  "audit_logs",
  "movements",
  "catalog_locations",
  "catalog_equipments",
  "catalog_sectors",
  "revoked_sessions",
  "app_settings",
  "users",
  "schema_migrations"
] as const;

const RESTORE_INSERT_ORDER = [
  "schema_migrations",
  "users",
  "app_settings",
  "catalog_sectors",
  "catalog_locations",
  "catalog_equipments",
  "movements",
  "audit_logs",
  "revoked_sessions"
] as const;

const REQUIRED_TABLES = [
  "users",
  "app_settings",
  "catalog_equipments",
  "catalog_sectors",
  "catalog_locations",
  "movements",
  "audit_logs"
] as const;

export function createBackupBuffer(db: DatabaseSync): Buffer {
  const tmpFile = path.join(os.tmpdir(), `twcin-backup-${crypto.randomUUID()}.db`);
  try {
    db.prepare("VACUUM INTO ?").run(tmpFile);
    return fs.readFileSync(tmpFile);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

const AUTO_BACKUP_PREFIX = "twcin-auto-";

/**
 * Grava uma cópia consistente do banco (VACUUM INTO) e mantém apenas os N arquivos mais recentes.
 */
export function runScheduledBackup(
  db: DatabaseSync,
  backupDir: string,
  retainCount = 14
): { filePath: string; pruned: number } {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const finalPath = path.join(backupDir, `${AUTO_BACKUP_PREFIX}${stamp}.db`);
  const tmpPath = `${finalPath}.tmp`;

  try {
    db.prepare("VACUUM INTO ?").run(tmpPath);
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }

  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith(AUTO_BACKUP_PREFIX) && f.endsWith(".db"))
    .sort((a, b) => b.localeCompare(a));

  let pruned = 0;
  for (const stale of files.slice(Math.max(1, retainCount))) {
    fs.rmSync(path.join(backupDir, stale), { force: true });
    pruned += 1;
  }

  return { filePath: finalPath, pruned };
}

export function startScheduledBackups(
  db: DatabaseSync,
  options: { backupDir: string; intervalHours: number; retainCount: number },
  onLog: (level: "info" | "error", msg: string) => void
): () => void {
  const intervalMs = Math.max(1, options.intervalHours) * 3600_000;

  const maybeRun = () => {
    try {
      fs.mkdirSync(options.backupDir, { recursive: true });
      const latest = fs
        .readdirSync(options.backupDir)
        .filter((f) => f.startsWith(AUTO_BACKUP_PREFIX) && f.endsWith(".db"))
        .sort((a, b) => b.localeCompare(a))[0];

      if (latest) {
        const stat = fs.statSync(path.join(options.backupDir, latest));
        if (Date.now() - stat.mtimeMs < intervalMs * 0.9) {
          return;
        }
      }

      const res = runScheduledBackup(db, options.backupDir, options.retainCount);
      onLog("info", `[twCIN] Backup automático gravado em ${res.filePath}`);
    } catch (err) {
      onLog("error", `[twCIN] Falha no backup automático: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Aguarda alguns segundos após o boot para não atrasar a subida do serviço.
  const bootTimer = setTimeout(maybeRun, 5000);
  bootTimer.unref();

  const periodic = setInterval(maybeRun, intervalMs);
  periodic.unref();

  return () => {
    clearTimeout(bootTimer);
    clearInterval(periodic);
  };
}

function copyTableRows(source: DatabaseSync, target: DatabaseSync, table: string): void {
  const cols = (target.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
  if (cols.length === 0) return;

  const colList = cols.join(", ");
  const placeholders = cols.map(() => "?").join(", ");
  const rows = source.prepare(`SELECT ${colList} FROM ${table}`).all() as Array<Record<string, unknown>>;
  if (rows.length === 0) return;

  const insert = target.prepare(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`);
  for (const row of rows) {
    insert.run(...(cols.map((col) => row[col] ?? null) as Array<string | number | null>));
  }
}

export function restoreBackupFromBase64(
  db: DatabaseSync,
  backupBase64: string,
  actor: AuthUser | null,
  ipAddress: string
): { restored_users: number; restored_equipments: number; restored_movements: number } {
  const cleanB64 = backupBase64.includes(",") ? backupBase64.split(",").pop() || "" : backupBase64;
  const buffer = Buffer.from(cleanB64.trim(), "base64");
  if (buffer.length < 100 || !buffer.subarray(0, 16).equals(SQLITE_MAGIC)) {
    throw new BadRequestError("O arquivo enviado não é um banco SQLite válido.");
  }

  const tmpFile = path.join(os.tmpdir(), `twcin-restore-${crypto.randomUUID()}.db`);
  let tmpDb: DatabaseSync | null = null;

  try {
    fs.writeFileSync(tmpFile, buffer, { mode: 0o600 });
    tmpDb = new DatabaseSync(tmpFile);

    const check = tmpDb.prepare("PRAGMA integrity_check;").get() as { integrity_check?: string } | undefined;
    if (check?.integrity_check !== "ok") {
      throw new BadRequestError("O arquivo de backup está corrompido.");
    }

    const existingTables = new Set(
      (tmpDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        (r) => r.name
      )
    );
    if (REQUIRED_TABLES.some((t) => !existingTables.has(t))) {
      throw new BadRequestError("Este arquivo não é um backup compatível com o twCIN.");
    }

    // Garante compatibilidade caso o backup venha de uma versão anterior do esquema.
    runMigrations(tmpDb);

    const adminCount = tmpDb
      .prepare("SELECT COUNT(*) AS count FROM users WHERE active = 1 AND role = 'admin'")
      .get() as { count: number };
    if (adminCount.count === 0) {
      throw new BadRequestError("O backup não contém nenhum usuário administrador ativo.");
    }

    const sourceDb = tmpDb;
    const stats = withTransaction(db, () => {
      for (const table of RESTORE_DELETE_ORDER) {
        db.exec(`DELETE FROM ${table};`);
      }
      for (const table of RESTORE_INSERT_ORDER) {
        if (existingTables.has(table) || table === "schema_migrations") {
          copyTableRows(sourceDb, db, table);
        }
      }

      if (existingTables.has("sqlite_sequence")) {
        const seqRows = sourceDb.prepare("SELECT name, seq FROM sqlite_sequence").all() as Array<{
          name: string;
          seq: number;
        }>;
        for (const row of seqRows) {
          db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(row.name);
          db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(row.name, row.seq);
        }
      }

      const restoredUsers = (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
      const restoredEquipments = (db.prepare("SELECT COUNT(*) AS c FROM catalog_equipments").get() as { c: number }).c;
      const restoredMovements = (db.prepare("SELECT COUNT(*) AS c FROM movements").get() as { c: number }).c;

      writeAuditLog(db, {
        userId: actor?.id ?? null,
        userName: actor?.full_name ?? "Setup inicial",
        action: "RESTORE",
        entity: "system",
        summary: actor
          ? `Backup restaurado por ${actor.full_name} (${restoredEquipments} equipamentos, ${restoredMovements} movimentações)`
          : `Backup importado na configuração inicial (${restoredEquipments} equipamentos, ${restoredMovements} movimentações)`,
        ipAddress
      });

      return {
        restored_users: restoredUsers,
        restored_equipments: restoredEquipments,
        restored_movements: restoredMovements
      };
    });

    return stats;
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    throw new BadRequestError("Não foi possível ler o arquivo de backup enviado.");
  } finally {
    try {
      tmpDb?.close();
    } catch {
      // ignore close error
    }
    fs.rmSync(tmpFile, { force: true });
    fs.rmSync(`${tmpFile}-wal`, { force: true });
    fs.rmSync(`${tmpFile}-shm`, { force: true });
  }
}
