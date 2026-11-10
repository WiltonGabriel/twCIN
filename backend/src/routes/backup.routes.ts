import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAuditLog } from "../security/audit.js";
import { verifyPassword } from "../security/password.js";
import { BadRequestError } from "../services/errors.js";

const backupSchema = z.object({
  password: z.string().min(1, "Confirme sua senha para baixar o backup.").max(128)
});

/**
 * Cópia consistente do banco SQLite (VACUUM INTO) para download.
 * O arquivo contém todos os dados, inclusive hashes de senha, por isso exige confirmar a senha.
 */
export function registerBackupRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  requireAuth: (req: any, reply: any) => Promise<void>
): void {
  app.post(
    "/api/backup",
    { preHandler: [requireAuth], config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = request.currentUser!;
      const { password } = backupSchema.parse(request.body);
      const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as
        | { password_hash: string }
        | undefined;
      if (!row || !verifyPassword(password, row.password_hash)) {
        throw new BadRequestError("Senha incorreta.");
      }

      const tmpFile = path.join(os.tmpdir(), `twcin-backup-${crypto.randomUUID()}.db`);
      try {
        db.prepare("VACUUM INTO ?").run(tmpFile);
        const content = fs.readFileSync(tmpFile);
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
      } finally {
        fs.rmSync(tmpFile, { force: true });
      }
    }
  );
}
