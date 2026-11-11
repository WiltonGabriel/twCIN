import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyLocalEquipmentCondition,
  getCachedSettings,
  getCachedSuggestions,
  offlineDb,
  type FailedOpEntry,
  type SyncQueueEntry
} from "../offline/db";
import {
  discardFailedOp,
  enqueueOfflineOperation,
  getPendingSyncCount,
  listFailedOps,
  retryFailedOp,
  runSyncCycle
} from "../offline/syncEngine";
import { apiRequest, isNetworkError } from "../services/api";
import type {
  AuthUser,
  CatalogEquipment,
  CatalogLocation,
  CatalogSector,
  EquipmentCondition,
  EquipmentOwnership,
  MovementItem,
  MovementType,
  PublicSettings,
  SuggestionsPayload,
  TiUser
} from "../types";

/**
 * Versão esperada após a operação offline enfileirada ser aplicada no servidor.
 * Itens já sincronizados (id > 0) são atualizados com expected_version, e o servidor faz version + 1.
 * Itens criados offline (id < 0) são atualizados por client_uuid sem expected_version.
 */
function localNextVersion(item: { id: number; version: number }): number {
  return item.id > 0 ? item.version + 1 : item.version;
}

let lastTempId = 0;
function nextTempId(): number {
  const now = -Date.now();
  lastTempId = now < lastTempId ? now : lastTempId - 1;
  return lastTempId;
}

async function resolveOfflineEquipmentPayload(
  equipmentId: number | null | undefined
): Promise<{ equipment_id?: number | null; equipment_client_uuid?: string | null }> {
  if (equipmentId === undefined) return {};
  if (equipmentId === null || equipmentId > 0) return { equipment_id: equipmentId };
  const localEq = await offlineDb.equipments.where("id").equals(equipmentId).first();
  return {
    equipment_id: null,
    equipment_client_uuid: localEq?.client_uuid ?? null
  };
}

export function useSyncData(
  user: AuthUser | null,
  onSessionExpired: () => void,
  onSettingsSynced?: (settings: PublicSettings) => void
) {
  const [movements, setMovements] = useState<MovementItem[]>([]);
  const [equipments, setEquipments] = useState<CatalogEquipment[]>([]);
  const [sectors, setSectors] = useState<CatalogSector[]>([]);
  const [locations, setLocations] = useState<CatalogLocation[]>([]);
  const [users, setUsers] = useState<TiUser[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionsPayload>({
    equipments: [],
    sectors: [],
    locations: [],
    people: []
  });
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const justSyncedTimerRef = useRef<number | null>(null);

  // Os callbacks chegam como funções novas a cada render do App (ex.: `() => setUser(null)`).
  // Antes eles entravam nas dependências de loadFromLocalDb/syncNow e do useEffect abaixo, então
  // cada render disparava um novo sync, que causava outro render: um laço infinito de
  // GET /api/sync/snapshot que estourava o rate limit (429) e acabava deslogando o usuário.
  const [failedOps, setFailedOps] = useState<FailedOpEntry[]>([]);
  const userIdRef = useRef<number | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;

  const onSessionExpiredRef = useRef(onSessionExpired);
  const onSettingsSyncedRef = useRef(onSettingsSynced);
  useEffect(() => {
    onSessionExpiredRef.current = onSessionExpired;
    onSettingsSyncedRef.current = onSettingsSynced;
  });

  const loadFromLocalDb = useCallback(async () => {
    const userId = userIdRef.current;
    if (userId === null) return;
    const [m, eq, sec, loc, usr, sug, cachedSettings, pend, failed] = await Promise.all([
      offlineDb.movements.toArray(),
      offlineDb.equipments.toArray(),
      offlineDb.sectors.toArray(),
      offlineDb.locations.toArray(),
      offlineDb.users.toArray(),
      getCachedSuggestions(),
      getCachedSettings(),
      getPendingSyncCount(userId),
      listFailedOps(userId)
    ]);

    onSettingsSyncedRef.current?.(cachedSettings);

    m.sort((x, y) => y.out_at.localeCompare(x.out_at));
    eq.sort((x, y) => y.updated_at.localeCompare(x.updated_at));
    sec.sort((x, y) => {
      if (x.is_default !== y.is_default) return y.is_default - x.is_default;
      return x.name.localeCompare(y.name, "pt-BR");
    });
    loc.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));

    setMovements(m);
    setEquipments(eq);
    setSectors(sec);
    setLocations(loc);
    setUsers(usr);
    setSuggestions(sug);
    setPendingCount(pend);
    setFailedOps(failed);
  }, []);

  const syncNow = useCallback(async (options?: { manual?: boolean }) => {
    if (!user) return;
    const manual = Boolean(options?.manual);
    if (manual && justSyncedTimerRef.current) {
      window.clearTimeout(justSyncedTimerRef.current);
      justSyncedTimerRef.current = null;
    }
    if (manual) setJustSynced(false);
    setSyncing(true);
    try {
      const [result] = await Promise.all([
        runSyncCycle(user.id),
        manual ? new Promise((r) => window.setTimeout(r, 550)) : Promise.resolve()
      ]);
      if (result.authExpired) {
        onSessionExpiredRef.current();
        return;
      }
      if (result.failed > 0) {
        setSyncNotice(
          result.failed === 1
            ? "1 alteração feita offline não pôde ser aplicada. Revise em Configurações → Sincronização."
            : `${result.failed} alterações feitas offline não puderam ser aplicadas. Revise em Configurações → Sincronização.`
        );
      } else if (manual && navigator.onLine) {
        setJustSynced(true);
        justSyncedTimerRef.current = window.setTimeout(() => {
          setJustSynced(false);
          justSyncedTimerRef.current = null;
        }, 1800);
      }
      await loadFromLocalDb();
    } catch {
      await loadFromLocalDb();
    } finally {
      setSyncing(false);
    }
  }, [user, loadFromLocalDb]);

  useEffect(() => {
    if (!user) return;
    void loadFromLocalDb().then(() => syncNow());

    const handleOnline = () => {
      setOnline(true);
      void syncNow();
    };
    const handleOffline = () => {
      setOnline(false);
    };
    const handleFocus = () => {
      if (navigator.onLine) {
        void syncNow();
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void syncNow();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    const interval = window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === "visible") {
        void syncNow();
      }
    }, 20000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(interval);
      if (justSyncedTimerRef.current) {
        window.clearTimeout(justSyncedTimerRef.current);
      }
    };
  }, [user, loadFromLocalDb, syncNow]);

  const queueMutation = async (
    entry: Omit<SyncQueueEntry, "id" | "op_id" | "created_at" | "user_id">
  ) => {
    if (!user) return;
    await enqueueOfflineOperation({ ...entry, user_id: user.id });
    await loadFromLocalDb();
  };

  const retryFailed = async (id: number, overwrite: boolean) => {
    await retryFailedOp(id, overwrite);
    await loadFromLocalDb();
    await syncNow();
  };

  const discardFailed = async (id: number) => {
    await discardFailedOp(id);
    await loadFromLocalDb();
  };

  const createEquipment = async (payload: {
    name: string;
    patrimony?: string;
    category?: string;
    ownership_type: EquipmentOwnership;
    condition_status: EquipmentCondition;
    origin_sector_id?: number | null;
    origin?: string;
    received_from?: string;
    received_at?: string;
    reason?: string;
    notes?: string;
  }): Promise<void> => {
    if (!user) return;
    const client_uuid = crypto.randomUUID();
    const now = new Date().toISOString();
    const safeOriginSectorId =
      payload.origin_sector_id && payload.origin_sector_id > 0 ? payload.origin_sector_id : null;
    const wirePayload = { ...payload, origin_sector_id: safeOriginSectorId, client_uuid };

    if (navigator.onLine) {
      try {
        await apiRequest<{ item: CatalogEquipment }>("/api/catalogs/equipments", {
          method: "POST",
          body: JSON.stringify(wirePayload)
        });
        await syncNow();
        return;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
      }
    }

    const optimistic: CatalogEquipment = {
      id: nextTempId(),
      client_uuid,
      name: payload.name.trim(),
      patrimony: payload.patrimony?.trim() || null,
      category: payload.category?.trim() || "",
      ownership_type: payload.ownership_type,
      condition_status: payload.condition_status,
      origin_sector_id: safeOriginSectorId,
      origin: payload.origin?.trim() || "",
      received_from: payload.received_from?.trim() || "",
      received_at: payload.received_at ?? now,
      reason: payload.reason?.trim() || "",
      notes: payload.notes?.trim() || "",
      active: 1,
      version: 1,
      created_by_id: user.id,
      created_by_name: user.full_name,
      updated_by_id: user.id,
      updated_by_name: user.full_name,
      created_at: now,
      updated_at: now,
      _pendingSync: true
    };
    await offlineDb.equipments.put(optimistic);
    await queueMutation({
      type: "equipment.create",
      client_uuid,
      payload: { ...wirePayload, received_at: payload.received_at ?? now },
      optimistic: { table: "equipments", record: optimistic }
    });
  };

  const updateEquipment = async (
    item: CatalogEquipment,
    patch: Partial<{
      name: string;
      patrimony: string;
      category: string;
      ownership_type: EquipmentOwnership;
      condition_status: EquipmentCondition;
      origin_sector_id: number | null;
      origin: string;
      received_from: string;
      received_at: string;
      reason: string;
      notes: string;
      active: boolean;
    }>
  ): Promise<void> => {
    if (!user) return;
    const now = new Date().toISOString();
    const wirePatch =
      patch.origin_sector_id !== undefined
        ? { ...patch, origin_sector_id: patch.origin_sector_id && patch.origin_sector_id > 0 ? patch.origin_sector_id : null }
        : patch;

    if (navigator.onLine && item.id > 0) {
      try {
        await apiRequest<{ item: CatalogEquipment }>(`/api/catalogs/equipments/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...wirePatch, expected_version: item.version })
        });
        await syncNow();
        return;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
      }
    }

    const updatedLocal: CatalogEquipment = {
      ...item,
      ...wirePatch,
      patrimony:
        patch.patrimony !== undefined ? patch.patrimony.trim() || null : item.patrimony,
      active: patch.active !== undefined ? (patch.active ? 1 : 0) : item.active,
      // O servidor incrementa a versão ao aplicar esta operação; refletimos isso localmente para que
      // uma segunda edição offline do mesmo item envie expected_version correto (antes virava conflito).
      version: localNextVersion(item),
      updated_by_id: user.id,
      updated_by_name: user.full_name,
      updated_at: now,
      _pendingSync: true
    };
    await offlineDb.equipments.put(updatedLocal);
    await queueMutation({
      type: "equipment.update",
      ...(item.id > 0 ? { entity_id: item.id } : { client_uuid: item.client_uuid }),
      payload: { ...wirePatch, ...(item.id > 0 ? { expected_version: item.version } : {}) },
      optimistic: { table: "equipments", record: updatedLocal }
    });
  };

  const createMovement = async (payload: {
    movement_type: MovementType;
    equipment_id?: number | null;
    equipment_name: string;
    patrimony?: string;
    sector_id?: number | null;
    sector_name: string;
    install_location: string;
    received_by?: string;
    notes?: string;
    /** Ausente = o servidor usa a hora dele (evita relógio errado do aparelho). */
    out_at?: string;
    /** Ausente = prazo padrão; null = sem prazo. */
    due_at?: string | null;
  }): Promise<void> => {
    if (!user) return;
    const client_uuid = crypto.randomUUID();
    const now = new Date().toISOString();
    const dependsOnOfflineEquipment = Boolean(payload.equipment_id && payload.equipment_id < 0);

    if (navigator.onLine && !dependsOnOfflineEquipment) {
      try {
        await apiRequest<{ item: MovementItem }>("/api/movements", {
          method: "POST",
          body: JSON.stringify({ ...payload, client_uuid })
        });
        await syncNow();
        return;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
      }
    }

    const optimistic: MovementItem = {
      id: nextTempId(),
      client_uuid,
      document_code: "PENDENTE",
      movement_type: payload.movement_type,
      equipment_id: payload.equipment_id ?? null,
      equipment_name: payload.equipment_name.trim(),
      patrimony: payload.patrimony?.trim() || "",
      sector_id: payload.sector_id ?? null,
      sector_name: payload.sector_name.trim(),
      install_location: payload.install_location.trim(),
      received_by: payload.received_by?.trim() || "",
      notes: payload.notes?.trim() || "",
      status: payload.movement_type === "instalacao_fixa" ? "fixo" : "ativo",
      version: 1,
      out_at: payload.out_at ?? now,
      due_at: payload.due_at ?? null,
      returned_at: null,
      registered_by_id: user.id,
      registered_by_name: user.full_name,
      returned_to_id: null,
      returned_to_name: null,
      created_at: now,
      updated_at: now,
      _pendingSync: true
    };
    await offlineDb.movements.put(optimistic);
    await applyLocalEquipmentCondition(
      payload.equipment_id,
      payload.movement_type === "instalacao_fixa" ? "em_uso" : "emprestado",
      true
    );
    const equipRef = await resolveOfflineEquipmentPayload(payload.equipment_id);
    await queueMutation({
      type: "movement.create",
      client_uuid,
      // Offline, a hora do aparelho é a melhor informação disponível.
      payload: { ...payload, ...equipRef, out_at: payload.out_at ?? now, client_uuid },
      optimistic: { table: "movements", record: optimistic }
    });
    if (navigator.onLine) {
      void syncNow();
    }
  };

  const updateMovement = async (
    item: MovementItem,
    patch: Partial<{
      movement_type: MovementType;
      equipment_id: number | null;
      equipment_name: string;
      patrimony: string;
      sector_id: number | null;
      sector_name: string;
      install_location: string;
      received_by: string;
      notes: string;
      out_at: string;
      due_at: string | null;
    }>
  ): Promise<void> => {
    if (!user) return;
    const now = new Date().toISOString();
    const dependsOnOfflineEquipment = Boolean(patch.equipment_id && patch.equipment_id < 0);

    if (navigator.onLine && item.id > 0 && !dependsOnOfflineEquipment) {
      try {
        await apiRequest<{ item: MovementItem }>(`/api/movements/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...patch, expected_version: item.version })
        });
        await syncNow();
        return;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
      }
    }

    const nextType = patch.movement_type ?? item.movement_type;
    const nextStatus =
      item.status !== "devolvido" && patch.movement_type !== undefined
        ? nextType === "instalacao_fixa"
          ? "fixo"
          : "ativo"
        : item.status;
    const nextDueAt =
      nextType === "instalacao_fixa"
        ? null
        : patch.due_at !== undefined
          ? patch.due_at
          : item.due_at;

    const updatedLocal: MovementItem = {
      ...item,
      ...patch,
      status: nextStatus,
      due_at: nextDueAt,
      version: localNextVersion(item),
      updated_at: now,
      _pendingSync: true
    };
    await offlineDb.movements.put(updatedLocal);

    if (nextStatus === "ativo" || nextStatus === "fixo") {
      const targetCond = nextType === "instalacao_fixa" ? "em_uso" : "emprestado";
      if (patch.equipment_id !== undefined && patch.equipment_id !== item.equipment_id) {
        await applyLocalEquipmentCondition(item.equipment_id, "disponivel", true);
        await applyLocalEquipmentCondition(patch.equipment_id, targetCond, true);
      } else if (patch.movement_type !== undefined) {
        await applyLocalEquipmentCondition(item.equipment_id, targetCond, true);
      }
    }

    const equipRef = await resolveOfflineEquipmentPayload(patch.equipment_id);
    await queueMutation({
      type: "movement.update",
      ...(item.id > 0 ? { entity_id: item.id } : { client_uuid: item.client_uuid }),
      payload: { ...patch, ...equipRef, ...(item.id > 0 ? { expected_version: item.version } : {}) },
      optimistic: { table: "movements", record: updatedLocal }
    });
    if (navigator.onLine) {
      void syncNow();
    }
  };

  const returnMovement = async (item: MovementItem): Promise<void> => {
    if (!user) return;
    const now = new Date().toISOString();

    if (navigator.onLine && item.id > 0) {
      try {
        await apiRequest<{ item: MovementItem }>(`/api/movements/${item.id}/return`, {
          method: "POST",
          // Online, o servidor carimba a hora da devolução.
          body: JSON.stringify({ expected_version: item.version })
        });
        await syncNow();
        return;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
      }
    }

    const updatedLocal: MovementItem = {
      ...item,
      status: "devolvido",
      returned_at: now,
      returned_to_id: user.id,
      returned_to_name: user.full_name,
      version: localNextVersion(item),
      updated_at: now,
      _pendingSync: true
    };
    await offlineDb.movements.put(updatedLocal);
    await applyLocalEquipmentCondition(item.equipment_id, "disponivel", true);
    await queueMutation({
      type: "movement.return",
      ...(item.id > 0 ? { entity_id: item.id } : { client_uuid: item.client_uuid }),
      payload: { returned_at: now, ...(item.id > 0 ? { expected_version: item.version } : {}) },
      optimistic: { table: "movements", record: updatedLocal }
    });
  };

  const returnEquipmentToOwner = async (
    item: CatalogEquipment,
    input: { received_by: string; returned_at?: string; notes?: string }
  ): Promise<void> => {
    if (!user) return;
    const now = new Date().toISOString();
    const returnedAt = input.returned_at || now;
    const mergedNotes = input.notes?.trim()
      ? [item.notes, `Devolução ao dono: ${input.notes.trim()}`].filter(Boolean).join("\n")
      : item.notes;

    if (navigator.onLine && item.id > 0) {
      try {
        await apiRequest<{ item: CatalogEquipment }>(`/api/catalogs/equipments/${item.id}/return-to-owner`, {
          method: "POST",
          body: JSON.stringify({ ...input, returned_at: returnedAt, expected_version: item.version })
        });
        await syncNow();
        return;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
      }
    }

    const updatedLocal: CatalogEquipment = {
      ...item,
      condition_status: "devolvido_dono",
      active: 0,
      owner_returned_at: returnedAt,
      owner_received_by: input.received_by.trim(),
      owner_returned_by_name: user.full_name,
      notes: mergedNotes,
      version: localNextVersion(item),
      updated_at: now,
      _pendingSync: true
    };
    await offlineDb.equipments.put(updatedLocal);
    await queueMutation({
      type: "equipment.return_to_owner",
      ...(item.id > 0 ? { entity_id: item.id } : { client_uuid: item.client_uuid }),
      payload: { ...input, returned_at: returnedAt, ...(item.id > 0 ? { expected_version: item.version } : {}) },
      optimistic: { table: "equipments", record: updatedLocal }
    });
  };

  const createSector = async (payload: {
    name: string;
    is_default?: boolean;
  }): Promise<CatalogSector> => {
    const trimmed = payload.name.trim();
    const existingLocal = sectors.find((s) => s.name.toLowerCase() === trimmed.toLowerCase());
    if (existingLocal) {
      return existingLocal;
    }

    if (navigator.onLine) {
      try {
        const res = await apiRequest<{ item: CatalogSector }>("/api/catalogs/sectors", {
          method: "POST",
          body: JSON.stringify({ name: trimmed, is_default: Boolean(payload.is_default) })
        });
        await syncNow();
        return res.item;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
      }
    }

    const now = new Date().toISOString();
    const optimistic: CatalogSector = {
      id: nextTempId(),
      name: trimmed,
      is_default: payload.is_default ? 1 : 0,
      active: 1,
      created_at: now,
      updated_at: now
    };
    await offlineDb.sectors.put(optimistic);
    await queueMutation({
      type: "sector.create",
      payload: { name: trimmed, is_default: Boolean(payload.is_default) },
      optimistic: { table: "sectors", record: optimistic }
    });
    return optimistic;
  };

  return {
    movements,
    equipments,
    sectors,
    locations,
    users,
    suggestions,
    online,
    pendingCount,
    failedOps,
    retryFailed,
    discardFailed,
    syncing,
    justSynced,
    syncNotice,
    clearSyncNotice: () => setSyncNotice(null),
    syncNow,
    createEquipment,
    updateEquipment,
    createMovement,
    updateMovement,
    returnMovement,
    returnEquipmentToOwner,
    createSector
  };
}
