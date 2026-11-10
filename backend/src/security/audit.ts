import type { DatabaseSync } from "node:sqlite";

export type AuditAction =
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "PASSWORD_CHANGE"
  | "SESSION_REVOKED"
  | "CREATE"
  | "UPDATE"
  | "STATUS_CHANGE"
  | "RETURN"
  | "RETURN_TO_OWNER"
  | "BACKUP"
  | "SYNC_CONFLICT";

export interface AuditEntry {
  userId: number | null;
  userName: string;
  action: AuditAction;
  entity: string;
  entityId?: number | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
}

export function writeAuditLog(db: DatabaseSync, entry: AuditEntry): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO audit_logs (
      user_id, user_name, action, entity, entity_id, summary, before_json, after_json, ip_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.userId,
    entry.userName,
    entry.action,
    entry.entity,
    entry.entityId ?? null,
    entry.summary,
    entry.before !== undefined ? JSON.stringify(entry.before) : null,
    entry.after !== undefined ? JSON.stringify(entry.after) : null,
    entry.ipAddress ?? "",
    now
  );
}
