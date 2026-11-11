import { apiRequest, ApiError, isNetworkError } from "../services/api";
import type {
  CatalogCategory,
  CatalogEquipment,
  CatalogLocation,
  CatalogSector,
  MovementItem,
  PublicSettings,
  SuggestionsPayload,
  TiUser
} from "../types";
import {
  applyLocalEquipmentCondition,
  belongsTo,
  offlineDb,
  saveCachedSettings,
  saveCachedSuggestions,
  type FailedOpEntry,
  type SyncQueueEntry
} from "./db";

export interface SnapshotResponse {
  server_time: string;
  settings: PublicSettings;
  movements: MovementItem[];
  catalog_equipments: CatalogEquipment[];
  catalog_sectors: CatalogSector[];
  catalog_categories?: CatalogCategory[];
  catalog_locations: CatalogLocation[];
  suggestions: SuggestionsPayload;
  users: TiUser[];
}

export interface SyncBatchResponse {
  results: Array<{
    op_id: string;
    status: "applied" | "conflict" | "error";
    record?: unknown;
    error?: string;
  }>;
  snapshot: SnapshotResponse;
}

export interface SyncCycleResult {
  synced: number;
  failed: number;
  authExpired?: boolean;
}

export async function applySnapshotToLocalDb(snapshot: SnapshotResponse): Promise<void> {
  await offlineDb.transaction(
    "rw",
    [
      offlineDb.movements,
      offlineDb.equipments,
      offlineDb.sectors,
      offlineDb.categories,
      offlineDb.locations,
      offlineDb.users,
      offlineDb.meta,
      offlineDb.syncQueue
    ],
    async () => {
      await offlineDb.movements.clear();
      if (snapshot.movements.length > 0) {
        await offlineDb.movements.bulkPut(snapshot.movements);
      }

      await offlineDb.equipments.clear();
      if (snapshot.catalog_equipments.length > 0) {
        await offlineDb.equipments.bulkPut(snapshot.catalog_equipments);
      }

      await offlineDb.sectors.clear();
      if (snapshot.catalog_sectors.length > 0) {
        await offlineDb.sectors.bulkPut(snapshot.catalog_sectors);
      }

      await offlineDb.categories.clear();
      const cats = snapshot.catalog_categories ?? [];
      if (cats.length > 0) {
        await offlineDb.categories.bulkPut(cats);
      }

      await offlineDb.locations.clear();
      if (snapshot.catalog_locations.length > 0) {
        await offlineDb.locations.bulkPut(snapshot.catalog_locations);
      }

      await offlineDb.users.clear();
      if (snapshot.users.length > 0) {
        await offlineDb.users.bulkPut(snapshot.users);
      }

      if (snapshot.settings) {
        await saveCachedSettings(snapshot.settings);
      }
      await saveCachedSuggestions({
        ...snapshot.suggestions,
        categories: snapshot.suggestions.categories ?? []
      });
      await offlineDb.meta.put({ key: "lastSyncAt", value: snapshot.server_time });

      // Operações ainda na fila (enfileiradas durante o envio, ou de outro usuário) continuam
      // visíveis: o snapshot do servidor ainda não as contém.
      const stillQueued = await offlineDb.syncQueue.orderBy("id").toArray();
      for (const entry of stillQueued) {
        if (!entry.optimistic) continue;
        if (entry.optimistic.table === "movements") {
          const mov = entry.optimistic.record;
          await offlineDb.movements.put(mov);
          const equipClientUuid = entry.payload.equipment_client_uuid;
          const resolvedEq =
            typeof equipClientUuid === "string" ? await offlineDb.equipments.get(equipClientUuid) : undefined;
          const targetEquipId = resolvedEq?.id ?? mov.equipment_id;
          if (entry.type === "movement.return") {
            await applyLocalEquipmentCondition(targetEquipId, "disponivel", true);
          } else if (mov.status === "ativo" || mov.status === "fixo") {
            await applyLocalEquipmentCondition(
              targetEquipId,
              mov.movement_type === "instalacao_fixa" ? "em_uso" : "emprestado",
              true
            );
          }
        } else if (entry.optimistic.table === "equipments") {
          await offlineDb.equipments.put(entry.optimistic.record);
        } else if (entry.optimistic.table === "sectors") {
          await offlineDb.sectors.put(entry.optimistic.record);
        } else {
          await offlineDb.categories.put(entry.optimistic.record);
        }
      }
    }
  );
}

let activeSyncPromise: Promise<SyncCycleResult> | null = null;

/**
 * Envia a fila do usuário logado e atualiza o cache local.
 * Operações recusadas (conflito/erro) NÃO são descartadas: vão para `failedOps`, onde a pessoa
 * decide reaplicar ou descartar (Configurações → Sincronização).
 */
export async function runSyncCycle(userId: number): Promise<SyncCycleResult> {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = (async () => {
    const queue = (await offlineDb.syncQueue.orderBy("id").toArray()).filter((q) => belongsTo(q, userId));
    let synced = 0;
    let failed = 0;

    try {
      if (queue.length > 0) {
        const res = await apiRequest<SyncBatchResponse>("/api/sync", {
          method: "POST",
          body: JSON.stringify({
            operations: queue.map((q) => ({
              op_id: q.op_id,
              type: q.type,
              ...(q.entity_id ? { entity_id: q.entity_id } : {}),
              ...(q.client_uuid ? { client_uuid: q.client_uuid } : {}),
              payload: q.payload
            }))
          })
        });

        const processedIds: number[] = [];
        const failures: FailedOpEntry[] = [];
        const now = new Date().toISOString();
        for (const item of res.results) {
          const matched = queue.find((q) => q.op_id === item.op_id);
          if (!matched || matched.id === undefined) continue;
          processedIds.push(matched.id);
          if (item.status === "applied") {
            synced++;
          } else {
            failed++;
            const { id: _id, ...rest } = matched;
            failures.push({
              ...rest,
              failed_at: now,
              status: item.status,
              error: item.error || "Erro de sincronização.",
              server_record: item.record
            });
          }
        }

        await offlineDb.transaction("rw", [offlineDb.syncQueue, offlineDb.failedOps], async () => {
          if (failures.length > 0) await offlineDb.failedOps.bulkAdd(failures);
          if (processedIds.length > 0) await offlineDb.syncQueue.bulkDelete(processedIds);
        });

        await applySnapshotToLocalDb(res.snapshot);
      } else {
        const snapshot = await apiRequest<SnapshotResponse>("/api/sync/snapshot");
        await applySnapshotToLocalDb(snapshot);
      }

      return { synced, failed };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return { synced: 0, failed: 0, authExpired: true };
      }
      if (isNetworkError(err)) {
        return { synced: 0, failed: 0 };
      }
      throw err;
    } finally {
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}

export async function enqueueOfflineOperation(
  entry: Omit<SyncQueueEntry, "id" | "op_id" | "created_at">
): Promise<void> {
  await offlineDb.syncQueue.add({
    ...entry,
    op_id: crypto.randomUUID(),
    created_at: new Date().toISOString()
  });
}

export async function getPendingSyncCount(userId: number): Promise<number> {
  return (await offlineDb.syncQueue.toArray()).filter((q) => belongsTo(q, userId)).length;
}

export async function listFailedOps(userId: number): Promise<FailedOpEntry[]> {
  return (await offlineDb.failedOps.orderBy("failed_at").reverse().toArray()).filter((f) =>
    belongsTo(f, userId)
  );
}

/**
 * Devolve uma operação recusada para a fila. Com `overwrite`, remove o expected_version para
 * aplicar por cima da versão atual do servidor (a pessoa escolheu manter a alteração dela).
 */
export async function retryFailedOp(id: number, overwrite: boolean): Promise<void> {
  const failedOp = await offlineDb.failedOps.get(id);
  if (!failedOp) return;
  const payload = { ...failedOp.payload };
  if (overwrite) delete payload.expected_version;
  await offlineDb.transaction("rw", [offlineDb.syncQueue, offlineDb.failedOps], async () => {
    await offlineDb.syncQueue.add({
      op_id: crypto.randomUUID(),
      type: failedOp.type,
      entity_id: failedOp.entity_id,
      client_uuid: failedOp.client_uuid,
      payload,
      created_at: new Date().toISOString(),
      user_id: failedOp.user_id,
      optimistic: failedOp.optimistic
    });
    await offlineDb.failedOps.delete(id);
  });
}

export async function discardFailedOp(id: number): Promise<void> {
  await offlineDb.failedOps.delete(id);
}
