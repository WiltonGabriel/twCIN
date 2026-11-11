import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAuditLog } from "../security/audit.js";
import { requireAdmin } from "../security/auth.js";
import { verifyPassword } from "../security/password.js";
import { createBackupBuffer, restoreBackupFromBase64 } from "../services/backup.service.js";
import { BadRequestError, ConflictError } from "../services/errors.js";

const backupSchema = z.object({
  password: z.string().min(1, "Confirme sua senha para baixar o backup.").max(128)
});

const restoreBase64Schema = z.string().trim().min(16, "Selecione um arquivo de backup válido.").max(48 * 1024 * 1024);

const restoreSchema = z.object({
  password: z.string().min(1, "Confirme sua senha para restaurar o backup.").max(128),
  backup_base64: restoreBase64Schema
});

const restoreInitialSchema = z.object({
  backup_base64: restoreBase64Schema
});

/**
 * Exportação consistente (VACUUM INTO) e importação atômica de backups SQLite (.db).
 * Por conter todos os dados e hashes de senha, requer perfil admin e confirmação de senha.
 */
export function registerBackupRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  requireAuth: (req: any, reply: any) => Promise<void>
): void {
  app.post(
    "/api/backup",
    { preHandler: [requireAuth, requireAdmin], config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = request.currentUser!;
      const { password } = backupSchema.parse(request.body);
      const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as
        | { password_hash: string }
        | undefined;
      if (!row || !verifyPassword(password, row.password_hash)) {
        throw new BadRequestError("Senha incorreta.");
      }

      const content = createBackupBuffer(db);
      writeAuditLog(db, {
        userId: user.id,
        userName: user.full_name,
        action: "BACKUP",
        entity: "system",
        summary: `Backup do banco baixado por ${user.full_name}`,
        ipAddress: request.ip
      });
      const stamp = new Date().toISOString().slice(0, 10);
      return reply
        .header("Content-Type", "application/vnd.sqlite3")
        .header("Content-Disposition", `attachment; filename="twcin-backup-${stamp}.db"`)
        .header("Cache-Control", "no-store")
        .send(content);
    }
  );

  app.post(
    "/api/backup/restore",
    {
      preHandler: [requireAuth, requireAdmin],
      bodyLimit: 50 * 1024 * 1024,
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } }
    },
    async (request) => {
      const user = request.currentUser!;
      const parsed = restoreSchema.parse(request.body);
      const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as
        | { password_hash: string }
        | undefined;
      if (!row || !verifyPassword(parsed.password, row.password_hash)) {
        throw new BadRequestError("Senha incorreta.");
      }

      return restoreBackupFromBase64(db, parsed.backup_base64, user, request.ip);
    }
  );

  app.post(
    "/api/backup/restore-initial",
    {
      bodyLimit: 50 * 1024 * 1024,
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } }
    },
    async (request) => {
      const countRow = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
      if (countRow.count > 0) {
        throw new ConflictError("A configuração inicial já foi realizada.");
      }
      const parsed = restoreInitialSchema.parse(request.body);
      return restoreBackupFromBase64(db, parsed.backup_base64, null, request.ip);
    }
  );
}
