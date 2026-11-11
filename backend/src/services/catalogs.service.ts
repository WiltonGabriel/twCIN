import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "../db/connection.js";
import { writeAuditLog } from "../security/audit.js";
import type { AuthUser } from "../security/auth.js";
import { findOpenMovement } from "./equipmentState.js";
import { BadRequestError, ConflictError, NotFoundError } from "./errors.js";

function assertSectorExists(db: DatabaseSync, sectorId: number | null | undefined): void {
  if (sectorId === null || sectorId === undefined) return;
  if (!db.prepare("SELECT id FROM catalog_sectors WHERE id = ?").get(sectorId)) {
    throw new BadRequestError("Setor informado não existe.");
  }
}

function resolveOriginFields(
  db: DatabaseSync,
  originSectorId: number | null | undefined,
  originText: string | undefined,
  fallbackSectorId: number | null,
  fallbackOrigin: string
): { originSectorId: number | null; origin: string } {
  if (originSectorId !== undefined) {
    if (originSectorId === null) {
      return {
        originSectorId: null,
        origin: originText !== undefined ? originText.trim() : fallbackOrigin
      };
    }
    const sector = db.prepare("SELECT id, name FROM catalog_sectors WHERE id = ?").get(originSectorId) as
      | { id: number; name: string }
      | undefined;
    if (!sector) {
      throw new BadRequestError("Setor informado não existe.");
    }
    const trimmed = originText !== undefined ? originText.trim() : "";
    return { originSectorId: sector.id, origin: trimmed || sector.name };
  }
  return {
    originSectorId: fallbackSectorId,
    origin: originText !== undefined ? originText.trim() : fallbackOrigin
  };
}

function resolveCategoryFields(
  db: DatabaseSync,
  categoryId: number | null | undefined,
  categoryText: string | undefined,
  fallbackId: number | null,
  fallbackName: string
): { categoryId: number | null; category: string } {
  if (categoryId !== undefined && categoryId !== null) {
    const row = db
      .prepare("SELECT id, name FROM catalog_categories WHERE id = ?")
      .get(categoryId) as { id: number; name: string } | undefined;
    if (!row) {
      throw new BadRequestError("Categoria informada não existe.");
    }
    return { categoryId: row.id, category: row.name };
  }
  if (categoryText !== undefined) {
    const trimmed = categoryText.trim();
    if (!trimmed) {
      return { categoryId: null, category: "" };
    }
    const matched = db
      .prepare("SELECT id, name FROM catalog_categories WHERE LOWER(name) = LOWER(?)")
      .get(trimmed) as { id: number; name: string } | undefined;
    if (matched) {
      return { categoryId: matched.id, category: matched.name };
    }
    return { categoryId: null, category: trimmed };
  }
  return { categoryId: fallbackId, category: fallbackName };
}

export type EquipmentOwnership = "proprio_ti" | "estoque" | "terceiro";
export type EquipmentCondition =
  | "disponivel"
  | "em_uso"
  | "manutencao"
  | "avaliacao"
  | "emprestado"
  | "descartado"
  | "devolvido_dono";

export interface CatalogEquipmentRow {
  id: number;
  client_uuid: string;
  name: string;
  patrimony: string | null;
  category_id: number | null;
  category: string;
  ownership_type: EquipmentOwnership;
  condition_status: EquipmentCondition;
  origin_sector_id: number | null;
  origin: string;
  received_from: string;
  received_at: string | null;
  reason: string;
  notes: string;
  active: number;
  version: number;
  created_by_id: number | null;
  created_by_name: string;
  updated_by_id: number | null;
  updated_by_name: string;
  owner_returned_at: string | null;
  owner_received_by: string;
  owner_returned_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface CatalogNamedRow {
  id: number;
  name: string;
  is_default: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export type CatalogSectorRow = CatalogNamedRow;
export type CatalogCategoryRow = CatalogNamedRow;

export interface CatalogLocationRow {
  id: number;
  name: string;
  sector_id: number | null;
  active: number;
  created_at: string;
}

export interface SuggestionsPayload {
  equipments: Array<{ id: number | null; name: string; patrimony: string }>;
  sectors: Array<{ id: number | null; name: string; is_default: boolean }>;
  categories: Array<{ id: number | null; name: string; is_default: boolean }>;
  locations: string[];
  people: string[];
}

export function listCatalogEquipments(db: DatabaseSync, includeInactive = false): CatalogEquipmentRow[] {
  const where = includeInactive ? "" : "WHERE active = 1";
  return db
    .prepare(`SELECT * FROM catalog_equipments ${where} ORDER BY updated_at DESC, name ASC`)
    .all() as unknown as CatalogEquipmentRow[];
}

export function findEquipmentByIdOrUuid(
  db: DatabaseSync,
  id?: number,
  clientUuid?: string
): CatalogEquipmentRow | undefined {
  if (id !== undefined) {
    return db.prepare("SELECT * FROM catalog_equipments WHERE id = ?").get(id) as unknown as
      | CatalogEquipmentRow
      | undefined;
  }
  if (clientUuid) {
    return db
      .prepare("SELECT * FROM catalog_equipments WHERE client_uuid = ?")
      .get(clientUuid) as unknown as CatalogEquipmentRow | undefined;
  }
  return undefined;
}

export function createCatalogEquipment(
  db: DatabaseSync,
  input: {
    client_uuid?: string;
    name: string;
    patrimony?: string;
    category_id?: number | null;
    category?: string;
    ownership_type?: EquipmentOwnership;
    condition_status?: EquipmentCondition;
    origin_sector_id?: number | null;
    origin?: string;
    received_from?: string;
    received_at?: string;
    reason?: string;
    notes?: string;
  },
  actor: AuthUser,
  ipAddress: string
): CatalogEquipmentRow {
  const clientUuid = input.client_uuid || crypto.randomUUID();
  const existingUuid = findEquipmentByIdOrUuid(db, undefined, clientUuid);
  if (existingUuid) {
    return existingUuid;
  }

  const now = new Date().toISOString();
  const receivedAt = input.received_at || now;
  const pat = input.patrimony?.trim() || null;

  if (input.condition_status === "emprestado" || input.condition_status === "devolvido_dono") {
    throw new BadRequestError("Essa situação é definida por uma movimentação ou pela devolução ao dono.");
  }

  const resolvedOrigin = resolveOriginFields(db, input.origin_sector_id, input.origin, null, "");
  const resolvedCategory = resolveCategoryFields(db, input.category_id, input.category, null, "");

  if (pat) {
    const dup = db.prepare("SELECT id FROM catalog_equipments WHERE LOWER(patrimony) = LOWER(?)").get(pat);
    if (dup) {
      throw new ConflictError("Já existe um equipamento cadastrado com este patrimônio.");
    }
  }

  return withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO catalog_equipments (
        client_uuid, name, patrimony, category_id, category, ownership_type, condition_status,
        origin_sector_id, origin, received_from, received_at, reason, notes, active, version,
        created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      clientUuid,
      input.name.trim(),
      pat,
      resolvedCategory.categoryId,
      resolvedCategory.category,
      input.ownership_type || "proprio_ti",
      input.condition_status || "disponivel",
      resolvedOrigin.originSectorId,
      resolvedOrigin.origin,
      input.received_from?.trim() || "",
      receivedAt,
      input.reason?.trim() || "",
      input.notes?.trim() || "",
      actor.id,
      actor.full_name,
      actor.id,
      actor.full_name,
      now,
      now
    );

    const created = findEquipmentByIdOrUuid(db, Number(info.lastInsertRowid))!;

    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "CREATE",
      entity: "catalog_equipment",
      entityId: created.id,
      summary: `Equipamento cadastrado: ${created.name}${created.patrimony ? ` (${created.patrimony})` : ""}`,
      after: created,
      ipAddress
    });

    return created;
  });
}

export function updateCatalogEquipment(
  db: DatabaseSync,
  idOrUuid: { id?: number; clientUuid?: string },
  input: {
    name?: string;
    patrimony?: string;
    category_id?: number | null;
    category?: string;
    ownership_type?: EquipmentOwnership;
    condition_status?: EquipmentCondition;
    origin_sector_id?: number | null;
    origin?: string;
    received_from?: string;
    received_at?: string;
    reason?: string;
    notes?: string;
    active?: boolean;
    expected_version?: number;
  },
  actor: AuthUser,
  ipAddress: string
): CatalogEquipmentRow {
  const current = findEquipmentByIdOrUuid(db, idOrUuid.id, idOrUuid.clientUuid);
  if (!current) {
    throw new NotFoundError("Equipamento não encontrado.");
  }

  if (input.expected_version !== undefined && input.expected_version !== current.version) {
    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "SYNC_CONFLICT",
      entity: "catalog_equipment",
      entityId: current.id,
      summary: `Conflito de versão no equipamento ${current.name}`,
      before: current,
      after: input,
      ipAddress
    });
    throw new ConflictError("Este equipamento foi atualizado por outro usuário.", { current });
  }

  // A situação "emprestado" e "devolvido ao dono" vêm de ações próprias, não da edição manual.
  const conditionChanged =
    input.condition_status !== undefined && input.condition_status !== current.condition_status;
  if (conditionChanged && input.condition_status === "emprestado") {
    throw new BadRequestError("A situação \"Emprestado\" é definida automaticamente ao registrar uma movimentação.");
  }
  if (conditionChanged && input.condition_status === "devolvido_dono") {
    throw new BadRequestError("Use a ação \"Devolver ao dono\" para registrar a devolução de um equipamento de terceiro.");
  }
  const openMovement = findOpenMovement(db, current.id);
  if (openMovement && (conditionChanged || input.active === false)) {
    throw new ConflictError(
      `O equipamento está fora na movimentação ${openMovement.document_code}. Registre a devolução antes de alterar a situação.`
    );
  }

  const nextReceivedAt = input.received_at ?? current.received_at ?? current.created_at;
  if (current.owner_returned_at && new Date(nextReceivedAt).getTime() > new Date(current.owner_returned_at).getTime()) {
    throw new BadRequestError("A data de recebimento não pode ser posterior à devolução ao dono.");
  }

  const resolvedOrigin = resolveOriginFields(
    db,
    input.origin_sector_id,
    input.origin,
    current.origin_sector_id,
    current.origin
  );
  const resolvedCategory = resolveCategoryFields(
    db,
    input.category_id,
    input.category,
    current.category_id,
    current.category
  );

  const nextPat = input.patrimony !== undefined ? input.patrimony.trim() || null : current.patrimony;
  if (nextPat) {
    const dup = db
      .prepare("SELECT id FROM catalog_equipments WHERE LOWER(patrimony) = LOWER(?) AND id != ?")
      .get(nextPat, current.id);
    if (dup) {
      throw new ConflictError("Já existe outro equipamento com este patrimônio.");
    }
  }

  const now = new Date().toISOString();
  return withTransaction(db, () => {
    db.prepare(`
      UPDATE catalog_equipments SET
        name = ?,
        patrimony = ?,
        category_id = ?,
        category = ?,
        ownership_type = ?,
        condition_status = ?,
        origin_sector_id = ?,
        origin = ?,
        received_from = ?,
        received_at = ?,
        reason = ?,
        notes = ?,
        active = ?,
        version = version + 1,
        updated_by_id = ?,
        updated_by_name = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.name !== undefined ? input.name.trim() : current.name,
      nextPat,
      resolvedCategory.categoryId,
      resolvedCategory.category,
      input.ownership_type !== undefined ? input.ownership_type : current.ownership_type,
      input.condition_status !== undefined ? input.condition_status : current.condition_status,
      resolvedOrigin.originSectorId,
      resolvedOrigin.origin,
      input.received_from !== undefined ? input.received_from.trim() : current.received_from,
      nextReceivedAt,
      input.reason !== undefined ? input.reason.trim() : current.reason,
      input.notes !== undefined ? input.notes.trim() : current.notes,
      input.active !== undefined ? (input.active ? 1 : 0) : current.active,
      actor.id,
      actor.full_name,
      now,
      current.id
    );

    const updated = findEquipmentByIdOrUuid(db, current.id)!;
    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action:
        input.condition_status !== undefined && input.condition_status !== current.condition_status
          ? "STATUS_CHANGE"
          : "UPDATE",
      entity: "catalog_equipment",
      entityId: updated.id,
      summary: `Equipamento atualizado: ${updated.name} (${updated.condition_status})`,
      before: current,
      after: updated,
      ipAddress
    });

    return updated;
  });
}

/**
 * Registra a devolução de um equipamento de terceiro/outro setor ao dono.
 * O equipamento sai do acervo ativo (active = 0) com situação "devolvido_dono" e o histórico fica preservado.
 */
export function returnEquipmentToOwner(
  db: DatabaseSync,
  idOrUuid: { id?: number; clientUuid?: string },
  input: { returned_at?: string; received_by: string; notes?: string; expected_version?: number },
  actor: AuthUser,
  ipAddress: string
): CatalogEquipmentRow {
  const current = findEquipmentByIdOrUuid(db, idOrUuid.id, idOrUuid.clientUuid);
  if (!current) {
    throw new NotFoundError("Equipamento não encontrado.");
  }
  if (current.condition_status === "devolvido_dono") {
    return current;
  }
  if (input.expected_version !== undefined && input.expected_version !== current.version) {
    throw new ConflictError("Este equipamento foi atualizado por outro usuário.", { current });
  }
  if (current.ownership_type !== "terceiro") {
    throw new BadRequestError("Só equipamentos recebidos de terceiros ou de outro setor podem ser devolvidos ao dono.");
  }
  const open = findOpenMovement(db, current.id);
  if (open) {
    throw new ConflictError(
      `O equipamento está fora na movimentação ${open.document_code}. Registre a devolução dela antes.`
    );
  }

  const now = new Date().toISOString();
  const returnedAt = input.returned_at || now;
  const baselineDate = current.received_at || current.created_at;
  if (new Date(returnedAt).getTime() < new Date(baselineDate).getTime()) {
    throw new BadRequestError("A data de devolução ao dono não pode ser anterior ao recebimento na TI.");
  }
  const notes = input.notes?.trim()
    ? [current.notes, `Devolução ao dono: ${input.notes.trim()}`].filter(Boolean).join("\n")
    : current.notes;

  return withTransaction(db, () => {
    db.prepare(`
      UPDATE catalog_equipments SET
        condition_status = 'devolvido_dono',
        active = 0,
        owner_returned_at = ?,
        owner_received_by = ?,
        owner_returned_by_name = ?,
        notes = ?,
        version = version + 1,
        updated_by_id = ?,
        updated_by_name = ?,
        updated_at = ?
      WHERE id = ?
    `).run(returnedAt, input.received_by.trim(), actor.full_name, notes, actor.id, actor.full_name, now, current.id);

    const updated = findEquipmentByIdOrUuid(db, current.id)!;
    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "RETURN_TO_OWNER",
      entity: "catalog_equipment",
      entityId: updated.id,
      summary: `Equipamento ${updated.name} devolvido ao dono (recebido por ${input.received_by.trim()})`,
      before: current,
      after: updated,
      ipAddress
    });
    return updated;
  });
}

interface NamedCatalogSpec {
  table: "catalog_sectors" | "catalog_categories";
  entity: "catalog_sector" | "catalog_category";
  label: string;
  alreadyExistsError: string;
  notFoundError: string;
  duplicateRenameError: string;
  onSyncEquipmentLinks?: (db: DatabaseSync, id: number, name: string) => void;
}

const SECTOR_CATALOG: NamedCatalogSpec = {
  table: "catalog_sectors",
  entity: "catalog_sector",
  label: "Setor",
  alreadyExistsError: "Este setor já está cadastrado.",
  notFoundError: "Setor não encontrado.",
  duplicateRenameError: "Já existe outro setor com este nome."
};

const CATEGORY_CATALOG: NamedCatalogSpec = {
  table: "catalog_categories",
  entity: "catalog_category",
  label: "Categoria",
  alreadyExistsError: "Esta categoria já está cadastrada.",
  notFoundError: "Categoria não encontrada.",
  duplicateRenameError: "Já existe outra categoria com este nome.",
  onSyncEquipmentLinks: (db, id, name) => {
    db.prepare("UPDATE catalog_equipments SET category = ? WHERE category_id = ?").run(name, id);
    db.prepare(
      "UPDATE catalog_equipments SET category_id = ?, category = ? WHERE category_id IS NULL AND LOWER(TRIM(category)) = LOWER(?)"
    ).run(id, name, name);
  }
};

function listNamedCatalog(db: DatabaseSync, spec: NamedCatalogSpec, includeInactive = false): CatalogNamedRow[] {
  const where = includeInactive ? "" : "WHERE active = 1";
  return db
    .prepare(`SELECT * FROM ${spec.table} ${where} ORDER BY is_default DESC, name ASC`)
    .all() as unknown as CatalogNamedRow[];
}

function createNamedCatalog(
  db: DatabaseSync,
  spec: NamedCatalogSpec,
  input: { name: string; is_default?: boolean },
  actor: AuthUser,
  ipAddress: string
): CatalogNamedRow {
  const trimmed = input.name.trim();
  const dup = db.prepare(`SELECT id FROM ${spec.table} WHERE LOWER(name) = LOWER(?)`).get(trimmed);
  if (dup) {
    throw new ConflictError(spec.alreadyExistsError);
  }

  const now = new Date().toISOString();
  return withTransaction(db, () => {
    if (input.is_default) {
      db.prepare(`UPDATE ${spec.table} SET is_default = 0, updated_at = ?`).run(now);
    }

    const info = db
      .prepare(
        `INSERT INTO ${spec.table} (name, is_default, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`
      )
      .run(trimmed, input.is_default ? 1 : 0, now, now);

    const createdId = Number(info.lastInsertRowid);
    spec.onSyncEquipmentLinks?.(db, createdId, trimmed);

    const created = db
      .prepare(`SELECT * FROM ${spec.table} WHERE id = ?`)
      .get(createdId) as unknown as CatalogNamedRow;

    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "CREATE",
      entity: spec.entity,
      entityId: created.id,
      summary: `${spec.label} cadastrad${spec.label === "Categoria" ? "a" : "o"}: ${created.name}`,
      after: created,
      ipAddress
    });

    return created;
  });
}

function updateNamedCatalog(
  db: DatabaseSync,
  spec: NamedCatalogSpec,
  id: number,
  input: { name?: string; is_default?: boolean; active?: boolean },
  actor: AuthUser,
  ipAddress: string
): CatalogNamedRow {
  const current = db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(id) as CatalogNamedRow | undefined;
  if (!current) {
    throw new NotFoundError(spec.notFoundError);
  }

  const nextName = input.name !== undefined ? input.name.trim() : current.name;
  const dup = db
    .prepare(`SELECT id FROM ${spec.table} WHERE LOWER(name) = LOWER(?) AND id != ?`)
    .get(nextName, id);
  if (dup) {
    throw new ConflictError(spec.duplicateRenameError);
  }

  const now = new Date().toISOString();
  return withTransaction(db, () => {
    if (input.is_default === true) {
      db.prepare(`UPDATE ${spec.table} SET is_default = 0, updated_at = ?`).run(now);
    }

    db.prepare(`
      UPDATE ${spec.table} SET name = ?, is_default = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      nextName,
      input.is_default !== undefined ? (input.is_default ? 1 : 0) : current.is_default,
      input.active !== undefined ? (input.active ? 1 : 0) : current.active,
      now,
      id
    );

    spec.onSyncEquipmentLinks?.(db, id, nextName);

    const updated = db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(id) as unknown as CatalogNamedRow;
    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "UPDATE",
      entity: spec.entity,
      entityId: updated.id,
      summary: `${spec.label} atualizad${spec.label === "Categoria" ? "a" : "o"}: ${updated.name}`,
      before: current,
      after: updated,
      ipAddress
    });

    return updated;
  });
}

export function listCatalogSectors(db: DatabaseSync, includeInactive = false): CatalogSectorRow[] {
  return listNamedCatalog(db, SECTOR_CATALOG, includeInactive);
}

export function createCatalogSector(
  db: DatabaseSync,
  input: { name: string; is_default?: boolean },
  actor: AuthUser,
  ipAddress: string
): CatalogSectorRow {
  return createNamedCatalog(db, SECTOR_CATALOG, input, actor, ipAddress);
}

export function updateCatalogSector(
  db: DatabaseSync,
  id: number,
  input: { name?: string; is_default?: boolean; active?: boolean },
  actor: AuthUser,
  ipAddress: string
): CatalogSectorRow {
  return updateNamedCatalog(db, SECTOR_CATALOG, id, input, actor, ipAddress);
}

export function listCatalogCategories(db: DatabaseSync, includeInactive = false): CatalogCategoryRow[] {
  return listNamedCatalog(db, CATEGORY_CATALOG, includeInactive);
}

export function createCatalogCategory(
  db: DatabaseSync,
  input: { name: string; is_default?: boolean },
  actor: AuthUser,
  ipAddress: string
): CatalogCategoryRow {
  return createNamedCatalog(db, CATEGORY_CATALOG, input, actor, ipAddress);
}

export function updateCatalogCategory(
  db: DatabaseSync,
  id: number,
  input: { name?: string; is_default?: boolean; active?: boolean },
  actor: AuthUser,
  ipAddress: string
): CatalogCategoryRow {
  return updateNamedCatalog(db, CATEGORY_CATALOG, id, input, actor, ipAddress);
}

export function listCatalogLocations(db: DatabaseSync, includeInactive = false): CatalogLocationRow[] {
  const where = includeInactive ? "" : "WHERE active = 1";
  return db
    .prepare(`SELECT * FROM catalog_locations ${where} ORDER BY name ASC`)
    .all() as unknown as CatalogLocationRow[];
}

export function createCatalogLocation(
  db: DatabaseSync,
  input: { name: string; sector_id?: number | null },
  actor: AuthUser,
  ipAddress: string
): CatalogLocationRow {
  const trimmed = input.name.trim();
  const dup = db.prepare("SELECT id FROM catalog_locations WHERE LOWER(name) = LOWER(?)").get(trimmed);
  if (dup) {
    throw new ConflictError("Este local já está cadastrado.");
  }
  assertSectorExists(db, input.sector_id);

  const now = new Date().toISOString();
  return withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO catalog_locations (name, sector_id, active, created_at)
      VALUES (?, ?, 1, ?)
    `).run(trimmed, input.sector_id ?? null, now);

    const created = db
      .prepare("SELECT * FROM catalog_locations WHERE id = ?")
      .get(Number(info.lastInsertRowid)) as unknown as CatalogLocationRow;

    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "CREATE",
      entity: "catalog_location",
      entityId: created.id,
      summary: `Local cadastrado: ${created.name}`,
      after: created,
      ipAddress
    });

    return created;
  });
}

export function updateCatalogLocation(
  db: DatabaseSync,
  id: number,
  input: { name?: string; sector_id?: number | null; active?: boolean },
  actor: AuthUser,
  ipAddress: string
): CatalogLocationRow {
  const current = db.prepare("SELECT * FROM catalog_locations WHERE id = ?").get(id) as
    | CatalogLocationRow
    | undefined;
  if (!current) {
    throw new NotFoundError("Local não encontrado.");
  }

  const nextName = input.name !== undefined ? input.name.trim() : current.name;
  const dup = db
    .prepare("SELECT id FROM catalog_locations WHERE LOWER(name) = LOWER(?) AND id != ?")
    .get(nextName, id);
  if (dup) {
    throw new ConflictError("Já existe outro local com este nome.");
  }
  if (input.sector_id !== undefined) {
    assertSectorExists(db, input.sector_id);
  }

  return withTransaction(db, () => {
    db.prepare(`
      UPDATE catalog_locations SET name = ?, sector_id = ?, active = ? WHERE id = ?
    `).run(
      nextName,
      input.sector_id !== undefined ? input.sector_id : current.sector_id,
      input.active !== undefined ? (input.active ? 1 : 0) : current.active,
      id
    );

    const updated = db.prepare("SELECT * FROM catalog_locations WHERE id = ?").get(id) as unknown as CatalogLocationRow;
    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "UPDATE",
      entity: "catalog_location",
      entityId: updated.id,
      summary: `Local atualizado: ${updated.name}`,
      before: current,
      after: updated,
      ipAddress
    });

    return updated;
  });
}

function collectNamedSuggestions(
  catalogRows: CatalogNamedRow[],
  inactiveNames: Set<string>,
  historicalRows: Array<{ name: string }>
): Array<{ id: number | null; name: string; is_default: boolean }> {
  const map = new Map<string, { id: number | null; name: string; is_default: boolean }>();
  for (const item of catalogRows) {
    map.set(item.name.toLowerCase(), {
      id: item.id,
      name: item.name,
      is_default: item.is_default === 1
    });
  }
  for (const row of historicalRows) {
    const trimmed = row.name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!map.has(key) && !inactiveNames.has(key)) {
      map.set(key, { id: null, name: trimmed, is_default: false });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

export function getSuggestions(db: DatabaseSync): SuggestionsPayload {
  const catEquips = listCatalogEquipments(db, false);
  const equipmentMap = new Map<string, { id: number | null; name: string; patrimony: string }>();

  for (const eq of catEquips) {
    const pat = eq.patrimony || "";
    const key = `${eq.name.toLowerCase()}|${pat.toLowerCase()}`;
    equipmentMap.set(key, { id: eq.id, name: eq.name, patrimony: pat });
  }

  // Itens desativados no catálogo não devem "voltar" pelas sugestões vindas do histórico.
  const inactiveEquipKeys = new Set(
    (
      db
        .prepare("SELECT name, patrimony FROM catalog_equipments WHERE active = 0")
        .all() as Array<{ name: string; patrimony: string | null }>
    ).map((eq) => `${eq.name.toLowerCase()}|${(eq.patrimony || "").toLowerCase()}`)
  );
  const inactiveSectorNames = new Set(
    (db.prepare("SELECT name FROM catalog_sectors WHERE active = 0").all() as Array<{ name: string }>).map(
      (s) => s.name.toLowerCase()
    )
  );
  const inactiveCategoryNames = new Set(
    (db.prepare("SELECT name FROM catalog_categories WHERE active = 0").all() as Array<{ name: string }>).map(
      (c) => c.name.toLowerCase()
    )
  );
  const inactiveLocationNames = new Set(
    (db.prepare("SELECT name FROM catalog_locations WHERE active = 0").all() as Array<{ name: string }>).map(
      (l) => l.name.toLowerCase()
    )
  );

  const recentEqRows = db
    .prepare("SELECT equipment_name, patrimony FROM movements WHERE equipment_name != ''")
    .all() as Array<{ equipment_name: string; patrimony: string }>;

  for (const row of recentEqRows) {
    const key = `${row.equipment_name.toLowerCase()}|${(row.patrimony || "").toLowerCase()}`;
    if (!equipmentMap.has(key) && !inactiveEquipKeys.has(key)) {
      equipmentMap.set(key, { id: null, name: row.equipment_name, patrimony: row.patrimony || "" });
    }
  }

  const recentSectorRows = db
    .prepare("SELECT DISTINCT sector_name AS name FROM movements WHERE sector_name != ''")
    .all() as Array<{ name: string }>;
  const recentCategoryRows = db
    .prepare("SELECT DISTINCT TRIM(category) AS name FROM catalog_equipments WHERE TRIM(category) != ''")
    .all() as Array<{ name: string }>;

  const locationSet = new Set<string>();
  for (const loc of listCatalogLocations(db, false)) {
    locationSet.add(loc.name);
  }
  const recentLocRows = db
    .prepare("SELECT DISTINCT install_location AS name FROM movements WHERE install_location != ''")
    .all() as Array<{ name: string }>;
  for (const row of recentLocRows) {
    if (!inactiveLocationNames.has(row.name.toLowerCase())) {
      locationSet.add(row.name);
    }
  }

  const peopleSet = new Set<string>();
  const peopleRows = db
    .prepare(`
      SELECT DISTINCT received_by AS name FROM movements WHERE received_by != ''
      UNION
      SELECT DISTINCT received_from AS name FROM catalog_equipments WHERE received_from != ''
      UNION
      SELECT DISTINCT owner_received_by AS name FROM catalog_equipments WHERE owner_received_by != ''
    `)
    .all() as Array<{ name: string }>;
  for (const row of peopleRows) {
    peopleSet.add(row.name);
  }

  return {
    equipments: Array.from(equipmentMap.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    sectors: collectNamedSuggestions(listCatalogSectors(db, false), inactiveSectorNames, recentSectorRows),
    categories: collectNamedSuggestions(listCatalogCategories(db, false), inactiveCategoryNames, recentCategoryRows),
    locations: Array.from(locationSet).sort((a, b) => a.localeCompare(b, "pt-BR")),
    people: Array.from(peopleSet).sort((a, b) => a.localeCompare(b, "pt-BR"))
  };
}
