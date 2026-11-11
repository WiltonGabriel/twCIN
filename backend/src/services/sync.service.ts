import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import { syncOperationSchema } from "../schemas/index.js";
import type { AuthUser } from "../security/auth.js";
import {
  createCatalogCategory,
  createCatalogEquipment,
  createCatalogSector,
  getSuggestions,
  listCatalogCategories,
  listCatalogEquipments,
  listCatalogLocations,
  listCatalogSectors,
  returnEquipmentToOwner,
  updateCatalogEquipment
} from "./catalogs.service.js";
import { ConflictError, NotFoundError } from "./errors.js";
import { createMovement, listMovements, returnMovement, updateMovement } from "./movements.service.js";
import { getPublicSettings } from "./settings.service.js";
import { listUsers } from "./users.service.js";

export type SyncOperation = z.infer<typeof syncOperationSchema>;

export interface SyncOpResult {
  op_id: string;
  status: "applied" | "conflict" | "error";
  record?: unknown;
  error?: string;
}

function extractOpId(raw: unknown): string {
  if (raw && typeof raw === "object" && "op_id" in raw) {
    const value = (raw as { op_id?: unknown }).op_id;
    if (typeof value === "string") return value;
  }
  return "";
}

export function processSyncBatch(
  db: DatabaseSync,
  operations: unknown[],
  actor: AuthUser,
  ipAddress: string
): SyncOpResult[] {
  const results: SyncOpResult[] = [];

  for (const raw of operations) {
    const parsedOp = syncOperationSchema.safeParse(raw);
    if (!parsedOp.success) {
      results.push({
        op_id: extractOpId(raw),
        status: "error",
        error: parsedOp.error.issues[0]?.message || "Operação de sincronização inválida."
      });
      continue;
    }
    const op: SyncOperation = parsedOp.data;

    try {
      switch (op.type) {
        case "equipment.create": {
          const created = createCatalogEquipment(db, op.payload, actor, ipAddress);
          results.push({ op_id: op.op_id, status: "applied", record: created });
          break;
        }
        case "equipment.update": {
          const updated = updateCatalogEquipment(
            db,
            { id: op.entity_id, clientUuid: op.client_uuid },
            op.payload,
            actor,
            ipAddress
          );
          results.push({ op_id: op.op_id, status: "applied", record: updated });
          break;
        }
        case "equipment.return_to_owner": {
          const returned = returnEquipmentToOwner(
            db,
            { id: op.entity_id, clientUuid: op.client_uuid },
            op.payload,
            actor,
            ipAddress
          );
          results.push({ op_id: op.op_id, status: "applied", record: returned });
          break;
        }
        case "movement.create": {
          const created = createMovement(db, op.payload, actor, ipAddress);
          results.push({ op_id: op.op_id, status: "applied", record: created });
          break;
        }
        case "movement.update": {
          const updated = updateMovement(
            db,
            { id: op.entity_id, clientUuid: op.client_uuid },
            op.payload,
            actor,
            ipAddress
          );
          results.push({ op_id: op.op_id, status: "applied", record: updated });
          break;
        }
        case "movement.return": {
          const returned = returnMovement(
            db,
            { id: op.entity_id, clientUuid: op.client_uuid },
            op.payload,
            actor,
            ipAddress
          );
          results.push({ op_id: op.op_id, status: "applied", record: returned });
          break;
        }
        case "sector.create": {
          const existing = db
            .prepare("SELECT * FROM catalog_sectors WHERE LOWER(name) = LOWER(?)")
            .get(op.payload.name.trim());
          const sector = existing ?? createCatalogSector(db, op.payload, actor, ipAddress);
          results.push({ op_id: op.op_id, status: "applied", record: sector });
          break;
        }
        case "category.create": {
          const existing = db
            .prepare("SELECT * FROM catalog_categories WHERE LOWER(name) = LOWER(?)")
            .get(op.payload.name.trim());
          const category = existing ?? createCatalogCategory(db, op.payload, actor, ipAddress);
          results.push({ op_id: op.op_id, status: "applied", record: category });
          break;
        }
      }
    } catch (err) {
      if (err instanceof ConflictError) {
        results.push({
          op_id: op.op_id,
          status: "conflict",
          record: (err.details as { current?: unknown } | undefined)?.current,
          error: err.message
        });
      } else if (err instanceof NotFoundError) {
        results.push({ op_id: op.op_id, status: "error", error: err.message });
      } else {
        results.push({
          op_id: op.op_id,
          status: "error",
          error: err instanceof Error ? err.message : "Erro ao processar sincronização."
        });
      }
    }
  }

  return results;
}

export function buildSyncSnapshot(db: DatabaseSync) {
  return {
    server_time: new Date().toISOString(),
    settings: getPublicSettings(db),
    movements: listMovements(db, { includeFinished: true }),
    catalog_equipments: listCatalogEquipments(db, true),
    catalog_sectors: listCatalogSectors(db, true),
    catalog_categories: listCatalogCategories(db, true),
    catalog_locations: listCatalogLocations(db, true),
    suggestions: getSuggestions(db),
    users: listUsers(db)
  };
}
