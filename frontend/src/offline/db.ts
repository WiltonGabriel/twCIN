import Dexie, { type Table } from "dexie";
import type {
  AuthUser,
  CatalogEquipment,
  CatalogLocation,
  CatalogSector,
  MovementItem,
  PublicSettings,
  SuggestionsPayload,
  TiUser
} from "../types";

export type SyncOperationType =
  | "equipment.create"
  | "equipment.update"
  | "equipment.return_to_owner"
  | "movement.create"
  | "movement.update"
  | "movement.return"
  | "sector.create";

/** Registro otimista exibido enquanto a operação não chega ao servidor. */
export type OptimisticRecord =
  | { table: "movements"; record: MovementItem }
  | { table: "equipments"; record: CatalogEquipment }
  | { table: "sectors"; record: CatalogSector };

export interface SyncQueueEntry {
  id?: number;
  op_id: string;
  type: SyncOperationType;
  entity_id?: number;
  client_uuid?: string;
  payload: Record<string, unknown>;
  created_at: string;
  /** Usuário que fez a operação. A fila só é enviada com a sessão desse mesmo usuário. */
  user_id?: number;
  /** Reaplicado na tela depois de cada snapshot, até a operação ser confirmada pelo servidor. */
  optimistic?: OptimisticRecord;
}

/** Operação recusada pelo servidor (conflito ou erro). Fica guardada até a pessoa decidir. */
export interface FailedOpEntry extends Omit<SyncQueueEntry, "id"> {
  id?: number;
  failed_at: string;
  status: "conflict" | "error";
  error: string;
  server_record?: unknown;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

class TwCinOfflineDb extends Dexie {
  movements!: Table<MovementItem, string>;
  equipments!: Table<CatalogEquipment, string>;
  sectors!: Table<CatalogSector, number>;
  locations!: Table<CatalogLocation, number>;
  users!: Table<TiUser, number>;
  syncQueue!: Table<SyncQueueEntry, number>;
  failedOps!: Table<FailedOpEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super("twcin_offline_v2");
    this.version(1).stores({
      movements: "client_uuid, id, status, out_at",
      equipments: "client_uuid, id, name, patrimony, ownership_type, condition_status",
      sectors: "id, name, is_default",
      locations: "id, name",
      users: "id, username",
      syncQueue: "++id, op_id, type, created_at",
      meta: "key"
    });
    this.version(2).stores({
      syncQueue: "++id, op_id, type, created_at, user_id",
      failedOps: "++id, op_id, user_id, failed_at"
    });
  }
}

export const offlineDb = new TwCinOfflineDb();

/** Operações pertencem ao usuário que as criou; entradas antigas (sem user_id) valem para quem estiver logado. */
export function belongsTo(entry: { user_id?: number }, userId: number): boolean {
  return entry.user_id === undefined || entry.user_id === userId;
}

export async function saveCachedUser(user: AuthUser | null): Promise<void> {
  if (!user) {
    await offlineDb.meta.delete("currentUser");
    return;
  }
  await offlineDb.meta.put({ key: "currentUser", value: user });
}

export async function getCachedUser(): Promise<AuthUser | null> {
  const row = await offlineDb.meta.get("currentUser");
  return (row?.value as AuthUser | undefined) ?? null;
}

export async function saveCachedSettings(settings: PublicSettings): Promise<void> {
  await offlineDb.meta.put({ key: "settings", value: settings });
}

export async function getCachedSettings(): Promise<PublicSettings> {
  const row = await offlineDb.meta.get("settings");
  return (
    (row?.value as PublicSettings | undefined) ?? {
      app_name: "twCIN",
      org_name: "Setor de TI",
      logo_data_url: ""
    }
  );
}

export async function saveCachedSuggestions(suggestions: SuggestionsPayload): Promise<void> {
  await offlineDb.meta.put({ key: "suggestions", value: suggestions });
}

export async function getCachedSuggestions(): Promise<SuggestionsPayload> {
  const row = await offlineDb.meta.get("suggestions");
  return (
    (row?.value as SuggestionsPayload | undefined) ?? {
      equipments: [],
      sectors: [],
      locations: [],
      people: []
    }
  );
}

/**
 * Remove do aparelho os dados da organização e o que pertence ao usuário que está saindo.
 * Operações pendentes de OUTROS usuários (sessão expirada no mesmo aparelho) são preservadas.
 */
export async function clearLocalDataForLogout(userId: number): Promise<void> {
  await offlineDb.transaction(
    "rw",
    [
      offlineDb.movements,
      offlineDb.equipments,
      offlineDb.sectors,
      offlineDb.locations,
      offlineDb.users,
      offlineDb.syncQueue,
      offlineDb.failedOps,
      offlineDb.meta
    ],
    async () => {
      await Promise.all([
        offlineDb.movements.clear(),
        offlineDb.equipments.clear(),
        offlineDb.sectors.clear(),
        offlineDb.locations.clear(),
        offlineDb.users.clear(),
        offlineDb.meta.delete("suggestions"),
        offlineDb.meta.delete("lastSyncAt"),
        offlineDb.meta.delete("currentUser")
      ]);
      const ownQueue = (await offlineDb.syncQueue.toArray()).filter((q) => belongsTo(q, userId));
      await offlineDb.syncQueue.bulkDelete(ownQueue.map((q) => q.id!).filter((id) => id !== undefined));
      const ownFailed = (await offlineDb.failedOps.toArray()).filter((f) => belongsTo(f, userId));
      await offlineDb.failedOps.bulkDelete(ownFailed.map((f) => f.id!).filter((id) => id !== undefined));
    }
  );
}
