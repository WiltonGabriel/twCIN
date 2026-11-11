import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "../db/connection.js";
import { writeAuditLog } from "../security/audit.js";
import type { AuthUser, UserRole } from "../security/auth.js";
import { hashPassword } from "../security/password.js";
import { BadRequestError, ConflictError, NotFoundError } from "./errors.js";

export interface PublicUserRow {
  id: number;
  full_name: string;
  username: string;
  role: UserRole;
  active: number;
  must_change_password: number;
  last_login_at: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

const PUBLIC_USER_COLUMNS =
  "id, full_name, username, role, active, must_change_password, last_login_at, password_changed_at, created_at, updated_at";

export function listUsers(db: DatabaseSync): PublicUserRow[] {
  return db
    .prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users ORDER BY active DESC, full_name ASC`)
    .all() as unknown as PublicUserRow[];
}

export function createUser(
  db: DatabaseSync,
  input: { full_name: string; username: string; password: string; role?: UserRole; must_change_password?: boolean },
  actor: AuthUser,
  ipAddress: string
): PublicUserRow {
  const normalizedUsername = input.username.trim().toLowerCase();
  const dup = db.prepare("SELECT id FROM users WHERE LOWER(username) = ?").get(normalizedUsername);
  if (dup) {
    throw new ConflictError("Este login já está em uso.");
  }

  const role: UserRole = input.role ?? "tecnico";
  const mustChange = input.must_change_password ?? true;
  const now = new Date().toISOString();
  return withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO users (
        full_name, username, password_hash, active, role, must_change_password, token_version, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, 1, ?, ?)
    `).run(
      input.full_name.trim(),
      normalizedUsername,
      hashPassword(input.password),
      role,
      mustChange ? 1 : 0,
      now,
      now
    );

    const created = db
      .prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`)
      .get(Number(info.lastInsertRowid)) as unknown as PublicUserRow;

    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "CREATE",
      entity: "user",
      entityId: created.id,
      summary: `Usuário criado: ${created.full_name} (@${created.username})`,
      after: created,
      ipAddress
    });

    return created;
  });
}

export function updateUser(
  db: DatabaseSync,
  id: number,
  input: {
    full_name?: string;
    username?: string;
    password?: string;
    role?: UserRole;
    active?: boolean;
    must_change_password?: boolean;
  },
  actor: AuthUser,
  ipAddress: string
): PublicUserRow {
  const current = db
    .prepare(`SELECT ${PUBLIC_USER_COLUMNS}, password_hash, token_version FROM users WHERE id = ?`)
    .get(id) as (PublicUserRow & { password_hash: string; token_version: number }) | undefined;

  if (!current) {
    throw new NotFoundError("Usuário não encontrado.");
  }

  if (input.active === false && id === actor.id) {
    throw new BadRequestError("Não é possível desativar o próprio usuário da sessão atual.");
  }
  if (input.role === "tecnico" && id === actor.id && current.role === "admin") {
    throw new BadRequestError("Não é possível remover o próprio perfil de administrador.");
  }

  const nextActive = input.active !== undefined ? (input.active ? 1 : 0) : current.active;
  const nextRole: UserRole = input.role ?? current.role;
  const leavingAdminPool = current.active === 1 && current.role === "admin" && (nextActive === 0 || nextRole !== "admin");
  if (leavingAdminPool) {
    const adminCount = db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE active = 1 AND role = 'admin'")
      .get() as { count: number };
    if (adminCount.count <= 1) {
      throw new BadRequestError("Deve permanecer ao menos um administrador ativo no sistema.");
    }
  }

  const nextUsername = input.username !== undefined ? input.username.trim().toLowerCase() : current.username;
  const dup = db
    .prepare("SELECT id FROM users WHERE LOWER(username) = ? AND id != ?")
    .get(nextUsername, id);
  if (dup) {
    throw new ConflictError("Este login já está sendo utilizado por outro usuário.");
  }

  const passwordChanged = Boolean(input.password);
  const roleChanged = nextRole !== current.role;
  const nextPasswordHash = input.password ? hashPassword(input.password) : current.password_hash;
  const nextMustChange =
    input.must_change_password !== undefined
      ? input.must_change_password
        ? 1
        : 0
      : current.must_change_password;

  const shouldBumpTokens = passwordChanged || roleChanged || input.active === false || nextMustChange === 1;
  const nextTokenVersion = shouldBumpTokens ? current.token_version + 1 : current.token_version;
  const now = new Date().toISOString();
  const nextPasswordChangedAt = passwordChanged ? now : current.password_changed_at;

  return withTransaction(db, () => {
    db.prepare(`
      UPDATE users SET
        full_name = ?,
        username = ?,
        password_hash = ?,
        active = ?,
        role = ?,
        must_change_password = ?,
        token_version = ?,
        password_changed_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.full_name !== undefined ? input.full_name.trim() : current.full_name,
      nextUsername,
      nextPasswordHash,
      nextActive,
      nextRole,
      nextMustChange,
      nextTokenVersion,
      nextPasswordChangedAt,
      now,
      id
    );

    const updated = db
      .prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`)
      .get(id) as unknown as PublicUserRow;

    const safeBefore = {
      id: current.id,
      full_name: current.full_name,
      username: current.username,
      role: current.role,
      active: current.active,
      must_change_password: current.must_change_password
    };

    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "UPDATE",
      entity: "user",
      entityId: updated.id,
      summary: `Usuário atualizado: ${updated.full_name}${passwordChanged ? " (senha redefinida)" : ""}`,
      before: safeBefore,
      after: updated,
      ipAddress
    });

    return updated;
  });
}

export function revokeUserSessions(
  db: DatabaseSync,
  id: number,
  actor: AuthUser,
  ipAddress: string
): PublicUserRow {
  const current = db
    .prepare(`SELECT ${PUBLIC_USER_COLUMNS}, token_version FROM users WHERE id = ?`)
    .get(id) as (PublicUserRow & { token_version: number }) | undefined;

  if (!current) {
    throw new NotFoundError("Usuário não encontrado.");
  }

  const now = new Date().toISOString();
  return withTransaction(db, () => {
    db.prepare("UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?").run(now, id);
    const updated = db
      .prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`)
      .get(id) as unknown as PublicUserRow;

    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "SESSION_REVOKED",
      entity: "user",
      entityId: updated.id,
      summary: `Sessões encerradas para ${updated.full_name} por ${actor.full_name}`,
      ipAddress
    });

    return updated;
  });
}
