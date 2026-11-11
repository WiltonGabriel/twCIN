import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  applyLocalEquipmentCondition,
  clearAllLocalData,
  clearLocalDataForLogout,
  offlineDb
} from "../src/offline/db";
import {
  applySnapshotToLocalDb,
  discardFailedOp,
  enqueueOfflineOperation,
  getPendingSyncCount,
  listFailedOps,
  retryFailedOp,
  runSyncCycle,
  type SnapshotResponse
} from "../src/offline/syncEngine";
import { daysOverdue, isOverdue, movementStatusLabel } from "../src/types/labels";
import { readableForeground, resolveBgHex } from "../src/theme/appearance";
import {
  clampCrop,
  dataUrlExtension,
  estimateDataUrlBytes,
  fitAspectCrop,
  getOutputDimensions,
  resizeCropByCorner
} from "../src/utils/imageEditor";
import {
  collectSectorFilterOptions,
  isIsoInLocalDateRange,
  matchEquipmentSector,
  matchMovementSector
} from "../src/utils/sectorFilters";
import type { CatalogEquipment, MovementItem } from "../src/types";

function makeEquipment(overrides?: Partial<CatalogEquipment>): CatalogEquipment {
  const now = "2026-11-10T10:00:00.000Z";
  return {
    id: 1,
    client_uuid: "00000000-0000-4000-8000-000000000001",
    name: "Notebook Dell",
    patrimony: "PAT-10",
    category: "Notebook",
    ownership_type: "proprio_ti",
    condition_status: "disponivel",
    origin: "",
    received_from: "",
    reason: "",
    notes: "",
    active: 1,
    version: 1,
    created_by_id: 1,
    created_by_name: "Admin",
    updated_by_id: 1,
    updated_by_name: "Admin",
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

function makeMovement(overrides?: Partial<MovementItem>): MovementItem {
  const now = "2026-11-10T10:00:00.000Z";
  return {
    id: 10,
    client_uuid: "00000000-0000-4000-8000-000000000010",
    document_code: "MOV-0010",
    movement_type: "emprestimo",
    equipment_id: 1,
    equipment_name: "Notebook Dell",
    patrimony: "PAT-10",
    sector_id: 1,
    sector_name: "RH",
    install_location: "Sala 1",
    received_by: "Maria",
    notes: "",
    status: "ativo",
    version: 1,
    out_at: now,
    due_at: "2026-11-17T10:00:00.000Z",
    returned_at: null,
    registered_by_id: 1,
    registered_by_name: "Admin",
    returned_to_id: null,
    returned_to_name: null,
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

function makeSnapshot(overrides?: Partial<SnapshotResponse>): SnapshotResponse {
  return {
    server_time: "2026-11-10T12:00:00.000Z",
    settings: { app_name: "twCIN", org_name: "TI", logo_data_url: "", loan_default_days: 7 },
    movements: [],
    catalog_equipments: [makeEquipment()],
    catalog_sectors: [],
    catalog_locations: [],
    suggestions: { equipments: [], sectors: [], locations: [], people: [] },
    users: [],
    ...overrides
  };
}

describe("twCIN Frontend — labels e motor offline", () => {
  beforeEach(async () => {
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
          offlineDb.syncQueue.clear(),
          offlineDb.failedOps.clear(),
          offlineDb.meta.clear()
        ]);
      }
    );
  });

  it("calcula atraso e rótulos de movimentação corretamente", () => {
    const past = "2026-11-01T12:00:00.000Z";
    const now = new Date("2026-11-04T12:00:00.000Z").getTime();
    assert.equal(isOverdue({ status: "ativo", due_at: past }, now), true);
    assert.equal(daysOverdue({ due_at: past }, now), 3);
    assert.equal(isOverdue({ status: "devolvido", due_at: past }, now), false);
    assert.equal(movementStatusLabel({ status: "fixo", due_at: null }), "Instalação fixa");
    assert.equal(movementStatusLabel({ status: "ativo", due_at: "2000-01-01T00:00:00.000Z" }), "Atrasado");
    assert.equal(readableForeground("#002d6b"), "#ffffff");
    assert.equal(readableForeground("#f8fafc"), "#0f172a");

    const lightFromDark = resolveBgHex("#111827", false);
    assert.ok(lightFromDark);
    assert.equal(readableForeground(lightFromDark), "#0f172a");
    assert.equal(resolveBgHex("#f0f7ff", false), "#f0f7ff");

    const darkFromDark = resolveBgHex("#111827", true);
    assert.ok(darkFromDark);
    assert.notEqual(darkFromDark, "#111827");
    assert.equal(readableForeground(darkFromDark), "#ffffff");
    assert.equal(resolveBgHex("", false), null);
  });

  it("calcula recorte proporcional, redimensionamento e metadados de imagem", () => {
    const sq = fitAspectCrop(1600, 900, 1);
    assert.ok(Math.abs(sq.h - 1) < 1e-6);
    assert.ok(Math.abs(sq.w - 9 / 16) < 1e-6);
    assert.ok(Math.abs(sq.x - (1 - 9 / 16) / 2) < 1e-6);

    const resized = resizeCropByCorner(sq, "se", -0.2, -0.2, 1600, 900, 1);
    assert.ok(resized.w < sq.w);
    assert.ok(Math.abs(resized.w * 1600 - resized.h * 900) < 1);

    const clamped = clampCrop({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
    assert.equal(clamped.x, 0.5);
    assert.equal(clamped.y, 0.5);

    const dims = getOutputDimensions(2000, 1000, { x: 0, y: 0, w: 1, h: 1 }, 512);
    assert.equal(dims.width, 512);
    assert.equal(dims.height, 256);

    assert.equal(dataUrlExtension("data:image/webp;base64,AAAA"), "webp");
    assert.equal(dataUrlExtension("data:image/jpeg;base64,AAAA"), "jpg");
    assert.equal(estimateDataUrlBytes("data:image/webp;base64,UklGRg=="), 4);
  });

  it("atualiza situação otimista do equipamento offline e preserva fila pendente após snapshot", async () => {
    const eq = makeEquipment();
    await offlineDb.equipments.put(eq);
    await applyLocalEquipmentCondition(eq.id, "emprestado", true);

    const updatedEq = await offlineDb.equipments.get(eq.client_uuid);
    assert.equal(updatedEq?.condition_status, "emprestado");
    assert.equal(updatedEq?.version, 2);

    const pendingMov = makeMovement({ id: -1, document_code: "PENDENTE" });
    await enqueueOfflineOperation({
      type: "movement.create",
      client_uuid: pendingMov.client_uuid,
      user_id: 1,
      payload: { equipment_id: eq.id },
      optimistic: { table: "movements", record: pendingMov }
    });

    // Mesmo após um snapshot do servidor ainda sem a movimentação, a fila pendente mantém ambos coerentes.
    await applySnapshotToLocalDb(makeSnapshot({ catalog_equipments: [makeEquipment({ condition_status: "disponivel" })] }));

    const afterEq = await offlineDb.equipments.get(eq.client_uuid);
    const afterMov = await offlineDb.movements.get(pendingMov.client_uuid);
    assert.equal(afterEq?.condition_status, "emprestado");
    assert.equal(afterEq?.version, 2);
    assert.equal(afterMov?.document_code, "PENDENTE");
  });

  it("processa lote no runSyncCycle, move conflito/erro para failedOps e permite retry/descarte", async () => {
    await enqueueOfflineOperation({
      type: "sector.create",
      user_id: 1,
      payload: { name: "TI" }
    });
    await enqueueOfflineOperation({
      type: "movement.update",
      entity_id: 10,
      user_id: 1,
      payload: { notes: "editado offline", expected_version: 1 }
    });

    const originalFetch = globalThis.fetch;
    try {
      let callCount = 0;
      globalThis.fetch = (async () => {
        callCount++;
        const queue = await offlineDb.syncQueue.orderBy("id").toArray();
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              results: [
                { op_id: queue[0].op_id, status: "applied" },
                { op_id: queue[1].op_id, status: "conflict", error: "Atualizado por outro usuário" }
              ],
              snapshot: makeSnapshot()
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            results: [{ op_id: queue[0].op_id, status: "applied" }],
            snapshot: makeSnapshot()
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch;

      const res1 = await runSyncCycle(1);
      assert.deepEqual(res1, { synced: 1, failed: 1 });
      assert.equal(await getPendingSyncCount(1), 0);

      const failed = await listFailedOps(1);
      assert.equal(failed.length, 1);
      assert.equal(failed[0].status, "conflict");

      // Reaplicar sobrescrevendo remove expected_version do payload.
      await retryFailedOp(failed[0].id!, true);
      const requeued = await offlineDb.syncQueue.toArray();
      assert.equal(requeued.length, 1);
      assert.equal("expected_version" in requeued[0].payload, false);

      const res2 = await runSyncCycle(1);
      assert.deepEqual(res2, { synced: 1, failed: 0 });
      assert.equal((await listFailedOps(1)).length, 0);

      // Teste de descarte.
      const addedFailId = await offlineDb.failedOps.add({
        op_id: "fail-discard",
        type: "movement.return",
        entity_id: 10,
        payload: {},
        created_at: "2026-11-10T10:00:00.000Z",
        failed_at: "2026-11-10T10:01:00.000Z",
        status: "error",
        error: "Erro",
        user_id: 1
      });
      await discardFailedOp(addedFailId);
      assert.equal((await listFailedOps(1)).length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserva fila offline em erro de rede/401 e isola dados no logout entre usuários", async () => {
    await offlineDb.equipments.put(makeEquipment());
    await enqueueOfflineOperation({ type: "sector.create", user_id: 1, payload: { name: "A" } });
    await enqueueOfflineOperation({ type: "sector.create", user_id: 2, payload: { name: "B" } });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { "content-type": "application/json" } })) as typeof fetch;
      const authRes = await runSyncCycle(1);
      assert.equal(authRes.authExpired, true);
      assert.equal(await getPendingSyncCount(1), 1);

      globalThis.fetch = (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch;
      const netRes = await runSyncCycle(1);
      assert.deepEqual(netRes, { synced: 0, failed: 0 });
      assert.equal(await getPendingSyncCount(1), 1);
    } finally {
      globalThis.fetch = originalFetch;
    }

    await clearLocalDataForLogout(1);
    assert.equal(await offlineDb.equipments.count(), 0);
    assert.equal(await getPendingSyncCount(1), 0);
    assert.equal(await getPendingSyncCount(2), 1, "fila de outro usuário no mesmo aparelho deve permanecer intacta");

    await clearAllLocalData();
    assert.equal(await getPendingSyncCount(2), 0, "clearAllLocalData limpa tudo após restauração de backup");
  });

  it("filtra setores por ID ou nome legado e respeita intervalo de datas do dossiê", () => {
    const sectorOpt = { id: 7, name: "Recursos Didáticos" };
    assert.equal(
      matchEquipmentSector({ origin_sector_id: 7, origin: "Nome Antigo", received_from: "" }, sectorOpt),
      true
    );
    assert.equal(
      matchEquipmentSector({ origin_sector_id: null, origin: "recursos didáticos", received_from: "" }, sectorOpt),
      true
    );
    assert.equal(
      matchEquipmentSector({ origin_sector_id: null, origin: "", received_from: "Secretaria" }, sectorOpt),
      false
    );
    assert.equal(
      matchMovementSector({ sector_id: 7, sector_name: "Antigo" }, sectorOpt),
      true
    );

    const eq = makeEquipment({ origin_sector_id: null, origin: "Laboratório 2" });
    const opts = collectSectorFilterOptions(
      [{ id: 7, name: "Recursos Didáticos", is_default: 0, active: 1, created_at: "", updated_at: "" }],
      [eq],
      []
    );
    assert.deepEqual(
      opts.map((o) => o.name),
      ["Laboratório 2", "Recursos Didáticos"]
    );

    assert.equal(isIsoInLocalDateRange("2026-11-10T15:00:00.000Z", "2026-11-10", "2026-11-10"), true);
    assert.equal(isIsoInLocalDateRange("2026-11-08T12:00:00.000Z", "2026-11-10", ""), false);
  });
});
