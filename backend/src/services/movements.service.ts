import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "../db/connection.js";
import { writeAuditLog } from "../security/audit.js";
import type { AuthUser } from "../security/auth.js";
import {
  BLOCKED_CONDITIONS,
  conditionForMovementType,
  findOpenMovement,
  setEquipmentConditionFromMovement
} from "./equipmentState.js";
import { BadRequestError, ConflictError, NotFoundError } from "./errors.js";
import { getPublicSettings } from "./settings.service.js";

export type MovementType = "emprestimo" | "instalacao_fixa";
export type MovementStatus = "ativo" | "devolvido" | "fixo";

export interface MovementRow {
  id: number;
  client_uuid: string;
  document_code: string;
  movement_type: MovementType;
  equipment_id: number | null;
  equipment_name: string;
  patrimony: string;
  sector_id: number | null;
  sector_name: string;
  install_location: string;
  received_by: string;
  notes: string;
  status: MovementStatus;
  version: number;
  out_at: string;
  due_at: string | null;
  returned_at: string | null;
  registered_by_id: number | null;
  registered_by_name: string;
  returned_to_id: number | null;
  returned_to_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMovementInput {
  client_uuid?: string;
  movement_type?: MovementType;
  equipment_id?: number | null;
  equipment_name: string;
  patrimony?: string;
  sector_id?: number | null;
  sector_name: string;
  install_location?: string;
  received_by?: string;
  notes?: string;
  out_at?: string;
  due_at?: string | null;
}

export interface UpdateMovementInput {
  movement_type?: MovementType;
  equipment_id?: number | null;
  equipment_name?: string;
  patrimony?: string;
  sector_id?: number | null;
  sector_name?: string;
  install_location?: string;
  received_by?: string;
  notes?: string;
  out_at?: string;
  due_at?: string | null;
  returned_at?: string | null;
  status?: MovementStatus;
  expected_version?: number;
}

export interface ReturnMovementInput {
  returned_at?: string;
  notes?: string;
  expected_version?: number;
}

const ALLOWED_STATUSES: Record<MovementType, MovementStatus[]> = {
  emprestimo: ["ativo", "devolvido"],
  instalacao_fixa: ["fixo", "devolvido"]
};

const OPEN_STATUSES: MovementStatus[] = ["ativo", "fixo"];
const DAY_MS = 24 * 60 * 60 * 1000;

function assertSectorExists(db: DatabaseSync, sectorId: number | null | undefined): void {
  if (sectorId === null || sectorId === undefined) return;
  const row = db.prepare("SELECT id FROM catalog_sectors WHERE id = ?").get(sectorId);
  if (!row) {
    throw new BadRequestError("Setor informado não existe.");
  }
}

/**
 * Garante que o equipamento do catálogo pode sair: existe, está ativo, não está descartado,
 * em manutenção, em avaliação ou devolvido ao dono, e não possui outra movimentação em aberto.
 */
function assertEquipmentAvailable(
  db: DatabaseSync,
  equipmentId: number | null | undefined,
  ignoreMovementId?: number
): { patrimony: string | null } | undefined {
  if (equipmentId === null || equipmentId === undefined) return undefined;

  const equipment = db
    .prepare("SELECT id, name, patrimony, active, condition_status FROM catalog_equipments WHERE id = ?")
    .get(equipmentId) as
    | { id: number; name: string; patrimony: string | null; active: number; condition_status: string }
    | undefined;

  if (!equipment) {
    throw new BadRequestError("Equipamento informado não existe.");
  }
  const blockedReason = BLOCKED_CONDITIONS[equipment.condition_status];
  if (blockedReason) {
    throw new BadRequestError(`O equipamento ${equipment.name} ${blockedReason} e não pode ser movimentado.`);
  }
  if (equipment.active !== 1) {
    throw new BadRequestError(`O equipamento ${equipment.name} está inativo e não pode ser movimentado.`);
  }

  const open = findOpenMovement(db, equipmentId, ignoreMovementId);
  if (open) {
    throw new ConflictError(
      `O equipamento ${equipment.name} já está fora na movimentação ${open.document_code}. Registre a devolução antes.`
    );
  }

  return { patrimony: equipment.patrimony };
}

function assertReturnAfterOut(outAt: string, returnedAt: string | null): void {
  if (!returnedAt) return;
  if (new Date(returnedAt).getTime() < new Date(outAt).getTime()) {
    throw new BadRequestError("A data de devolução não pode ser anterior à data de saída.");
  }
}

function assertDueAfterOut(outAt: string, dueAt: string | null): void {
  if (!dueAt) return;
  if (new Date(dueAt).getTime() < new Date(outAt).getTime()) {
    throw new BadRequestError("O prazo de devolução não pode ser anterior à data de saída.");
  }
}

function defaultDueAt(db: DatabaseSync, outAt: string): string | null {
  const days = getPublicSettings(db).loan_default_days;
  if (days <= 0) return null;
  return new Date(new Date(outAt).getTime() + days * DAY_MS).toISOString();
}

function generateNextDocumentCode(db: DatabaseSync): string {
  const row = db.prepare("SELECT COALESCE(MAX(id), 0) AS max_id FROM movements").get() as { max_id: number };
  const nextNumber = row.max_id + 1;
  return `MOV-${String(nextNumber).padStart(4, "0")}`;
}

export function listMovements(
  db: DatabaseSync,
  filters?: {
    status?: string;
    includeFinished?: boolean;
    sector?: string;
    sectorId?: number;
    search?: string;
    overdue?: boolean;
  }
): MovementRow[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  } else if (!filters?.includeFinished) {
    conditions.push("status = 'ativo'");
  }

  if (filters?.sectorId !== undefined) {
    conditions.push("sector_id = ?");
    params.push(filters.sectorId);
  } else if (filters?.sector?.trim()) {
    conditions.push("sector_name = ?");
    params.push(filters.sector.trim());
  }

  if (filters?.overdue) {
    conditions.push("status = 'ativo' AND due_at IS NOT NULL AND due_at < ?");
    params.push(new Date().toISOString());
  }

  if (filters?.search?.trim()) {
    const like = `%${filters.search.trim()}%`;
    conditions.push(
      "(document_code LIKE ? OR equipment_name LIKE ? OR patrimony LIKE ? OR sector_name LIKE ? OR install_location LIKE ? OR received_by LIKE ? OR registered_by_name LIKE ?)"
    );
    params.push(like, like, like, like, like, like, like);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM movements ${where} ORDER BY out_at DESC, id DESC`)
    .all(...params) as unknown as MovementRow[];
}

export function findMovementByIdOrUuid(db: DatabaseSync, id?: number, clientUuid?: string): MovementRow | undefined {
  if (id !== undefined) {
    return db.prepare("SELECT * FROM movements WHERE id = ?").get(id) as unknown as MovementRow | undefined;
  }
  if (clientUuid) {
    return db.prepare("SELECT * FROM movements WHERE client_uuid = ?").get(clientUuid) as unknown as MovementRow | undefined;
  }
  return undefined;
}

export function createMovement(
  db: DatabaseSync,
  input: CreateMovementInput,
  actor: AuthUser,
  ipAddress: string
): MovementRow {
  const clientUuid = input.client_uuid || crypto.randomUUID();
  const existing = findMovementByIdOrUuid(db, undefined, clientUuid);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const movementType: MovementType = input.movement_type || "emprestimo";
  const status: MovementStatus = movementType === "instalacao_fixa" ? "fixo" : "ativo";
  const outAt = input.out_at || now;

  return withTransaction(db, () => {
    assertSectorExists(db, input.sector_id);
    const equipment = assertEquipmentAvailable(db, input.equipment_id);
    const patrimony = input.patrimony?.trim() || equipment?.patrimony || "";

    let dueAt: string | null = null;
    if (movementType === "emprestimo") {
      dueAt = input.due_at !== undefined ? input.due_at : defaultDueAt(db, outAt);
      assertDueAfterOut(outAt, dueAt);
    }

    const documentCode = generateNextDocumentCode(db);
    const info = db.prepare(`
      INSERT INTO movements (
        client_uuid, document_code, movement_type, equipment_id, equipment_name,
        patrimony, sector_id, sector_name, install_location, received_by, notes,
        status, version, out_at, due_at, returned_at, registered_by_id, registered_by_name,
        returned_to_id, returned_to_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?)
    `).run(
      clientUuid,
      documentCode,
      movementType,
      input.equipment_id ?? null,
      input.equipment_name.trim(),
      patrimony,
      input.sector_id ?? null,
      input.sector_name.trim(),
      input.install_location?.trim() || "",
      input.received_by?.trim() || "",
      input.notes?.trim() || "",
      status,
      outAt,
      dueAt,
      actor.id,
      actor.full_name,
      now,
      now
    );

    const created = findMovementByIdOrUuid(db, Number(info.lastInsertRowid))!;
    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "CREATE",
      entity: "movement",
      entityId: created.id,
      summary: `Movimentação ${created.document_code}: ${created.equipment_name} → ${created.sector_name}`,
      after: created,
      ipAddress
    });

    setEquipmentConditionFromMovement(
      db,
      created.equipment_id,
      conditionForMovementType(movementType),
      `saída ${created.document_code}`,
      actor,
      ipAddress
    );

    return created;
  });
}

export function updateMovement(
  db: DatabaseSync,
  idOrUuid: { id?: number; clientUuid?: string },
  input: UpdateMovementInput,
  actor: AuthUser,
  ipAddress: string
): MovementRow {
  const current = findMovementByIdOrUuid(db, idOrUuid.id, idOrUuid.clientUuid);
  if (!current) {
    throw new NotFoundError("Movimentação não encontrada.");
  }

  if (input.expected_version !== undefined && input.expected_version !== current.version) {
    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "SYNC_CONFLICT",
      entity: "movement",
      entityId: current.id,
      summary: `Conflito de versão na movimentação ${current.document_code}`,
      before: current,
      after: input,
      ipAddress
    });
    throw new ConflictError("Esta movimentação foi atualizada por outro usuário.", { current });
  }

  const now = new Date().toISOString();
  const nextType = input.movement_type ?? current.movement_type;
  let nextStatus = input.status ?? current.status;
  if (input.status === undefined && input.movement_type !== undefined) {
    if (nextType === "instalacao_fixa" && current.status === "ativo") {
      nextStatus = "fixo";
    } else if (nextType === "emprestimo" && current.status === "fixo") {
      nextStatus = "ativo";
    }
  }

  let nextReturnedAt = input.returned_at !== undefined ? input.returned_at : current.returned_at;
  let nextReturnedToId = current.returned_to_id;
  let nextReturnedToName = current.returned_to_name;

  if (nextStatus === "devolvido" && current.status !== "devolvido") {
    nextReturnedAt = nextReturnedAt || now;
    nextReturnedToId = actor.id;
    nextReturnedToName = actor.full_name;
  } else if (nextStatus !== "devolvido" && current.status === "devolvido") {
    nextReturnedAt = null;
    nextReturnedToId = null;
    nextReturnedToName = null;
  }

  // Regras de consistência de estado (antes era possível gravar "empréstimo" com status "fixo",
  // ou "devolvido" sem data de devolução).
  if (!ALLOWED_STATUSES[nextType].includes(nextStatus)) {
    throw new BadRequestError(
      nextType === "emprestimo"
        ? "Um empréstimo só pode estar ativo ou devolvido."
        : "Uma instalação fixa só pode estar fixa ou devolvida."
    );
  }
  if (nextStatus === "devolvido" && !nextReturnedAt) {
    throw new BadRequestError("Uma movimentação devolvida precisa ter data de devolução.");
  }
  if (nextStatus !== "devolvido" && input.returned_at) {
    throw new BadRequestError("Só é possível informar data de devolução em movimentações devolvidas.");
  }

  const nextOutAt = input.out_at !== undefined ? input.out_at : current.out_at;
  assertReturnAfterOut(nextOutAt, nextReturnedAt);

  // Prazo só existe em empréstimo.
  let nextDueAt = input.due_at !== undefined ? input.due_at : current.due_at;
  if (nextType === "instalacao_fixa") {
    nextDueAt = null;
  } else if (current.movement_type === "instalacao_fixa" && input.due_at === undefined) {
    nextDueAt = defaultDueAt(db, nextOutAt);
  }
  assertDueAfterOut(nextOutAt, nextDueAt);

  const nextEquipmentId = input.equipment_id !== undefined ? input.equipment_id : current.equipment_id;
  const nextSectorId = input.sector_id !== undefined ? input.sector_id : current.sector_id;
  const equipmentChanged = nextEquipmentId !== current.equipment_id;
  const wasOpen = OPEN_STATUSES.includes(current.status);
  const isOpen = OPEN_STATUSES.includes(nextStatus);
  const reopening = isOpen && !wasOpen;

  return withTransaction(db, () => {
    if (nextSectorId !== current.sector_id) {
      assertSectorExists(db, nextSectorId);
    }
    if (isOpen && (equipmentChanged || reopening)) {
      assertEquipmentAvailable(db, nextEquipmentId, current.id);
    }

    db.prepare(`
      UPDATE movements SET
        movement_type = ?,
        equipment_id = ?,
        equipment_name = ?,
        patrimony = ?,
        sector_id = ?,
        sector_name = ?,
        install_location = ?,
        received_by = ?,
        notes = ?,
        out_at = ?,
        due_at = ?,
        returned_at = ?,
        status = ?,
        returned_to_id = ?,
        returned_to_name = ?,
        version = version + 1,
        updated_at = ?
      WHERE id = ?
    `).run(
      nextType,
      nextEquipmentId,
      input.equipment_name !== undefined ? input.equipment_name.trim() : current.equipment_name,
      input.patrimony !== undefined ? input.patrimony.trim() : current.patrimony,
      nextSectorId,
      input.sector_name !== undefined ? input.sector_name.trim() : current.sector_name,
      input.install_location !== undefined ? input.install_location.trim() : current.install_location,
      input.received_by !== undefined ? input.received_by.trim() : current.received_by,
      input.notes !== undefined ? input.notes.trim() : current.notes,
      nextOutAt,
      nextDueAt,
      nextReturnedAt,
      nextStatus,
      nextReturnedToId,
      nextReturnedToName,
      now,
      current.id
    );

    const updated = findMovementByIdOrUuid(db, current.id)!;
    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: nextStatus === "devolvido" && current.status !== "devolvido" ? "RETURN" : "UPDATE",
      entity: "movement",
      entityId: updated.id,
      summary: `Movimentação ${updated.document_code} editada`,
      before: current,
      after: updated,
      ipAddress
    });

    // Mantém a situação dos equipamentos coerente com a movimentação.
    const reason = `movimentação ${updated.document_code}`;
    if (wasOpen && (equipmentChanged || !isOpen)) {
      setEquipmentConditionFromMovement(db, current.equipment_id, "disponivel", reason, actor, ipAddress);
    }
    if (isOpen) {
      setEquipmentConditionFromMovement(
        db,
        nextEquipmentId,
        conditionForMovementType(nextType),
        reason,
        actor,
        ipAddress
      );
    }

    return updated;
  });
}

export function returnMovement(
  db: DatabaseSync,
  idOrUuid: { id?: number; clientUuid?: string },
  input: ReturnMovementInput,
  actor: AuthUser,
  ipAddress: string
): MovementRow {
  const current = findMovementByIdOrUuid(db, idOrUuid.id, idOrUuid.clientUuid);
  if (!current) {
    throw new NotFoundError("Movimentação não encontrada.");
  }

  if (current.status === "devolvido") {
    return current;
  }

  if (input.expected_version !== undefined && input.expected_version !== current.version) {
    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "SYNC_CONFLICT",
      entity: "movement",
      entityId: current.id,
      summary: `Conflito ao registrar devolução de ${current.document_code}`,
      before: current,
      after: input,
      ipAddress
    });
    throw new ConflictError("Esta movimentação foi atualizada por outro usuário.", { current });
  }

  const now = new Date().toISOString();
  const returnedAt = input.returned_at || now;
  assertReturnAfterOut(current.out_at, returnedAt);
  const nextNotes = input.notes !== undefined ? input.notes.trim() : current.notes;

  return withTransaction(db, () => {
    db.prepare(`
      UPDATE movements SET
        status = 'devolvido',
        returned_at = ?,
        returned_to_id = ?,
        returned_to_name = ?,
        notes = ?,
        version = version + 1,
        updated_at = ?
      WHERE id = ?
    `).run(returnedAt, actor.id, actor.full_name, nextNotes, now, current.id);

    const updated = findMovementByIdOrUuid(db, current.id)!;
    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "RETURN",
      entity: "movement",
      entityId: updated.id,
      summary:
        current.movement_type === "instalacao_fixa"
          ? `Instalação ${updated.document_code} desfeita (${updated.equipment_name})`
          : `Devolução registrada para ${updated.document_code} (${updated.equipment_name})`,
      before: current,
      after: updated,
      ipAddress
    });

    setEquipmentConditionFromMovement(
      db,
      updated.equipment_id,
      "disponivel",
      `devolução ${updated.document_code}`,
      actor,
      ipAddress
    );

    return updated;
  });
}
