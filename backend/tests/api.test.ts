import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { EnvConfig } from "../src/config/env.js";

function createTestEnv(overrides?: Partial<EnvConfig>): EnvConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    corsOrigin: "http://localhost:5173",
    cookieSecure: false,
    jwtSecret: crypto.randomBytes(32).toString("hex"),
    dbPath: ":memory:",
    seedAdminName: "Técnico Um",
    seedAdminUsername: "tecnico1",
    seedAdminPassword: "test-password-123",
    ...overrides
  };
}

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  assert.ok(setCookieHeader, "Cookie de sessão deve ser definido");
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw.split(";")[0];
}

async function loginAndCompleteFirstPassword(
  app: FastifyInstance,
  username: string,
  currentPassword: string,
  newPassword: string
): Promise<string> {
  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password: currentPassword }
  });
  assert.equal(loginRes.statusCode, 200);
  const firstCookie = extractCookie(loginRes.headers["set-cookie"]);

  if (loginRes.json().user.must_change_password) {
    const changeRes = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: firstCookie },
      payload: { current_password: currentPassword, new_password: newPassword }
    });
    assert.equal(changeRes.statusCode, 200);
    assert.equal(changeRes.json().user.must_change_password, false);
    return extractCookie(changeRes.headers["set-cookie"]);
  }

  return firstCookie;
}

describe("twCIN API", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("permite setup inicial único quando não há usuários e bloqueia segundo setup", async () => {
    const built = await buildApp({
      env: createTestEnv({
        seedAdminName: undefined,
        seedAdminUsername: undefined,
        seedAdminPassword: undefined
      })
    });
    app = built.app;

    const statusBefore = await app.inject({ method: "GET", url: "/api/auth/status" });
    assert.equal(statusBefore.statusCode, 200);
    assert.equal(statusBefore.json().needs_setup, true);

    const setupRes = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: {
        full_name: "Admin TI",
        username: "adminti",
        password: "senha-forte-setup-99",
        app_name: "TechBench",
        org_name: "Empresa Exemplo"
      }
    });
    assert.equal(setupRes.statusCode, 201);
    assert.equal(setupRes.json().user.must_change_password, false);

    const statusAfter = await app.inject({ method: "GET", url: "/api/auth/status" });
    assert.equal(statusAfter.json().needs_setup, false);

    const secondSetup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: {
        full_name: "Outro",
        username: "outro",
        password: "outra-senha-99"
      }
    });
    assert.equal(secondSetup.statusCode, 409);

    const pubSettings = await app.inject({ method: "GET", url: "/api/settings/public" });
    assert.equal(pubSettings.json().settings.app_name, "TechBench");
    assert.equal(pubSettings.json().settings.org_name, "Empresa Exemplo");
  });

  it("exige troca de senha no primeiro login, invalida token antigo, bloqueia rota sem troca e aplica rate limit", async () => {
    const built = await buildApp({
      env: createTestEnv(),
      loginRateLimitMax: 3,
      globalRateLimitMax: 100
    });
    app = built.app;

    const unauthRes = await app.inject({ method: "GET", url: "/api/catalogs/equipments" });
    assert.equal(unauthRes.statusCode, 401);

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "tecnico1", password: "test-password-123" }
    });
    assert.equal(loginRes.statusCode, 200);
    assert.equal(loginRes.json().user.must_change_password, true);
    assert.ok(loginRes.json().user.last_login_at);
    const initialCookie = extractCookie(loginRes.headers["set-cookie"]);

    const blockedEquip = await app.inject({
      method: "GET",
      url: "/api/catalogs/equipments",
      headers: { cookie: initialCookie }
    });
    assert.equal(blockedEquip.statusCode, 403);
    assert.equal(blockedEquip.json().code, "PASSWORD_CHANGE_REQUIRED");

    const samePassRes = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: initialCookie },
      payload: { current_password: "test-password-123", new_password: "test-password-123" }
    });
    assert.equal(samePassRes.statusCode, 400);

    const changeRes = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: initialCookie },
      payload: { current_password: "test-password-123", new_password: "nova-senha-segura-99" }
    });
    assert.equal(changeRes.statusCode, 200);
    assert.equal(changeRes.json().user.must_change_password, false);
    const freshCookie = extractCookie(changeRes.headers["set-cookie"]);

    const staleRes = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: initialCookie }
    });
    assert.equal(staleRes.statusCode, 401);

    const allowedEquip = await app.inject({
      method: "GET",
      url: "/api/catalogs/equipments",
      headers: { cookie: freshCookie }
    });
    assert.equal(allowedEquip.statusCode, 200);

    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "tecnico1", password: "wrong" }
    });
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "tecnico1", password: "wrong" }
    });
    const rateLimited = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "tecnico1", password: "wrong" }
    });
    assert.equal(rateLimited.statusCode, 429);
  });

  it("cadastra equipamentos com origem, propriedade e situação, consulta detalhes com movimentações e grava audit_logs", async () => {
    const built = await buildApp({ env: createTestEnv() });
    app = built.app;

    const cookie = await loginAndCompleteFirstPassword(
      app,
      "tecnico1",
      "test-password-123",
      "tecnico1-nova-senha-2026"
    );

    const createEqRes = await app.inject({
      method: "POST",
      url: "/api/catalogs/equipments",
      headers: { cookie },
      payload: {
        name: "Notebook Recepção 02",
        ownership_type: "terceiro",
        condition_status: "manutencao",
        origin: "Recepção",
        received_from: "Ana",
        reason: "Tela piscando e bateria viciada"
      }
    });
    assert.equal(createEqRes.statusCode, 201);
    const eq = createEqRes.json().item;
    assert.equal(eq.patrimony, null);
    assert.equal(eq.ownership_type, "terceiro");
    assert.equal(eq.condition_status, "manutencao");
    assert.equal(eq.received_from, "Ana");
    assert.equal(eq.created_by_name, "Técnico Um");

    // Cria movimentação vinculada ao equipamento (exigindo install_location)
    const missingLocRes = await app.inject({
      method: "POST",
      url: "/api/movements",
      headers: { cookie },
      payload: {
        equipment_id: eq.id,
        equipment_name: eq.name,
        sector_name: "Recepção",
        install_location: ""
      }
    });
    assert.equal(missingLocRes.statusCode, 400);

    // Equipamento em manutenção não pode sair (decisão de produto).
    const blockedMovRes = await app.inject({
      method: "POST",
      url: "/api/movements",
      headers: { cookie },
      payload: {
        equipment_id: eq.id,
        equipment_name: eq.name,
        sector_name: "Recepção",
        install_location: "Balcão Principal"
      }
    });
    assert.equal(blockedMovRes.statusCode, 400);

    // Atualiza situação do equipamento
    const patchEqRes = await app.inject({
      method: "PATCH",
      url: `/api/catalogs/equipments/${eq.id}`,
      headers: { cookie },
      payload: {
        condition_status: "disponivel",
        expected_version: eq.version
      }
    });
    assert.equal(patchEqRes.statusCode, 200);
    assert.equal(patchEqRes.json().item.version, 2);

    const movRes = await app.inject({
      method: "POST",
      url: "/api/movements",
      headers: { cookie },
      payload: {
        equipment_id: eq.id,
        equipment_name: eq.name,
        sector_name: "Recepção",
        install_location: "Balcão Principal"
      }
    });
    assert.equal(movRes.statusCode, 201);

    // Consulta detalhes do equipamento com movimentações vinculadas
    const detailsRes = await app.inject({
      method: "GET",
      url: `/api/catalogs/equipments/${eq.id}`,
      headers: { cookie }
    });
    assert.equal(detailsRes.statusCode, 200);
    assert.equal(detailsRes.json().item.condition_status, "emprestado", "situação atualizada pela saída");
    assert.equal(detailsRes.json().movements.length, 1);

    const auditRes = await app.inject({
      method: "GET",
      url: `/api/audit?entity=catalog_equipment&entity_id=${eq.id}`,
      headers: { cookie }
    });
    assert.equal(auditRes.statusCode, 200);
    // CREATE + STATUS_CHANGE manual + STATUS_CHANGE automático da saída
    assert.equal(auditRes.json().items.length, 3);
  });

  it("cria movimentação, registra devolução e garante idempotência e conflito no /api/sync", async () => {
    const built = await buildApp({ env: createTestEnv() });
    app = built.app;

    const cookie = await loginAndCompleteFirstPassword(
      app,
      "tecnico1",
      "test-password-123",
      "tecnico1-nova-senha-2026"
    );

    const offlineUuid = crypto.randomUUID();
    const syncRes1 = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { cookie },
      payload: {
        operations: [
          {
            op_id: "op-1",
            type: "movement.create",
            payload: {
              client_uuid: offlineUuid,
              movement_type: "emprestimo",
              equipment_name: "Projetor Epson S41+",
              patrimony: "PAT-0205",
              sector_name: "Setor Audiovisual",
              install_location: "Sala 102"
            }
          }
        ]
      }
    });
    assert.equal(syncRes1.statusCode, 200);
    const createdMov = syncRes1.json().results[0].record;
    assert.equal(createdMov.document_code, "MOV-0001");
    assert.equal(createdMov.registered_by_name, "Técnico Um");
    assert.equal(createdMov.received_by, "");

    const syncResDup = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { cookie },
      payload: {
        operations: [
          {
            op_id: "op-1",
            type: "movement.create",
            payload: {
              client_uuid: offlineUuid,
              movement_type: "emprestimo",
              equipment_name: "Projetor Epson S41+",
              patrimony: "PAT-0205",
              sector_name: "Setor Audiovisual",
              install_location: "Sala 102"
            }
          }
        ]
      }
    });
    assert.equal(syncResDup.json().snapshot.movements.length, 1);

    const retRes = await app.inject({
      method: "POST",
      url: `/api/movements/${createdMov.id}/return`,
      headers: { cookie },
      payload: {}
    });
    assert.equal(retRes.statusCode, 200);
    assert.equal(retRes.json().item.status, "devolvido");
    assert.equal(retRes.json().item.version, 2);

    const syncConflictRes = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { cookie },
      payload: {
        operations: [
          {
            op_id: "op-stale",
            type: "movement.update",
            entity_id: createdMov.id,
            payload: {
              install_location: "Auditório",
              expected_version: 1
            }
          }
        ]
      }
    });
    assert.equal(syncConflictRes.statusCode, 200);
    assert.equal(syncConflictRes.json().results[0].status, "conflict");

    const syncSectorRes = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { cookie },
      payload: {
        operations: [
          {
            op_id: "op-sec-1",
            type: "sector.create",
            payload: {
              name: "Almoxarifado Central",
              is_default: false
            }
          },
          {
            op_id: "op-sec-2",
            type: "sector.create",
            payload: {
              name: "almoxarifado central",
              is_default: false
            }
          }
        ]
      }
    });
    assert.equal(syncSectorRes.statusCode, 200);
    assert.equal(syncSectorRes.json().results[0].status, "applied");
    assert.equal(syncSectorRes.json().results[1].status, "applied");
    assert.equal(syncSectorRes.json().results[0].record.id, syncSectorRes.json().results[1].record.id);
    assert.ok(
      syncSectorRes
        .json()
        .snapshot.catalog_sectors.some((s: { name: string }) => s.name === "Almoxarifado Central")
    );
  });

  it("cria usuários, valida configurações de organização e bloqueia SVG inseguro", async () => {
    const built = await buildApp({ env: createTestEnv() });
    app = built.app;

    const cookie = await loginAndCompleteFirstPassword(
      app,
      "tecnico1",
      "test-password-123",
      "tecnico1-nova-senha-2026"
    );

    const createNoForceRes = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie },
      payload: {
        full_name: "Técnico Dois",
        username: "tecnico2",
        password: "secret-user-1",
        must_change_password: false
      }
    });
    assert.equal(createNoForceRes.statusCode, 201);
    const user2Id = createNoForceRes.json().item.id;
    assert.equal(createNoForceRes.json().item.must_change_password, 0);

    const login2 = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "tecnico2", password: "secret-user-1" }
    });
    assert.equal(login2.statusCode, 200);
    const cookie2 = extractCookie(login2.headers["set-cookie"]);

    const revokeRes = await app.inject({
      method: "POST",
      url: `/api/users/${user2Id}/revoke-sessions`,
      headers: { cookie },
      payload: {}
    });
    assert.equal(revokeRes.statusCode, 200);

    const afterRevoke = await app.inject({
      method: "GET",
      url: "/api/catalogs/equipments",
      headers: { cookie: cookie2 }
    });
    assert.equal(afterRevoke.statusCode, 401);

    const disableRes = await app.inject({
      method: "PATCH",
      url: `/api/users/${user2Id}`,
      headers: { cookie },
      payload: { active: false }
    });
    assert.equal(disableRes.statusCode, 200);

    const loginDisabled = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "tecnico2", password: "secret-user-1" }
    });
    assert.equal(loginDisabled.statusCode, 401);

    const svgReject = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: {
        logo_data_url: "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+"
      }
    });
    assert.equal(svgReject.statusCode, 400);

    const pngValid = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: {
        app_name: "twCIN Custom",
        org_name: "Minha Organização"
      }
    });
    assert.equal(pngValid.statusCode, 200);
    assert.equal(pngValid.json().settings.org_name, "Minha Organização");
  });
});

describe("twCIN API — correções da auditoria (fase 1)", () => {
  let app: FastifyInstance | null = null;
  let cookie = "";

  async function setup(options?: { loginRateLimitMax?: number }) {
    const built = await buildApp({
      env: createTestEnv(),
      globalRateLimitMax: 1000,
      loginRateLimitMax: options?.loginRateLimitMax
    });
    app = built.app;
    cookie = await loginAndCompleteFirstPassword(app, "tecnico1", "test-password-123", "tecnico1-nova-senha-2026");
    return app;
  }

  async function call(method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
    const res = await app!.inject({ method, url, headers: { cookie }, payload: payload as any });
    return { status: res.statusCode, body: res.json() };
  }

  const baseMovement = { equipment_name: "Mouse USB", sector_name: "RH", install_location: "Sala 1" };

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("rejeita datas inválidas e devolução anterior à saída", async () => {
    await setup();

    const lixo = await call("POST", "/api/movements", { ...baseMovement, out_at: "aaaaaaaaaa" });
    assert.equal(lixo.status, 400);

    const mov = await call("POST", "/api/movements", { ...baseMovement, out_at: "2026-11-10T10:00:00.000Z" });
    assert.equal(mov.status, 201);
    const id = mov.body.item.id;

    const antes = await call("POST", `/api/movements/${id}/return`, { returned_at: "2026-11-09T10:00:00.000Z" });
    assert.equal(antes.status, 400);

    const ok = await call("POST", `/api/movements/${id}/return`, { returned_at: "2026-11-10T12:00:00.000Z" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.item.status, "devolvido");

    const saidaDepois = await call("PATCH", `/api/movements/${id}`, { out_at: "2026-11-11T10:00:00.000Z" });
    assert.equal(saidaDepois.status, 400);
  });

  it("impede estados impossíveis na edição de movimentações", async () => {
    await setup();

    const mov = (await call("POST", "/api/movements", baseMovement)).body.item;
    await call("POST", `/api/movements/${mov.id}/return`, {});

    const semData = await call("PATCH", `/api/movements/${mov.id}`, { returned_at: null });
    assert.equal(semData.status, 400);

    const emprestimo = (await call("POST", "/api/movements", { ...baseMovement, equipment_name: "Teclado" })).body.item;
    const fixoEmEmprestimo = await call("PATCH", `/api/movements/${emprestimo.id}`, {
      status: "fixo",
      movement_type: "emprestimo"
    });
    assert.equal(fixoEmEmprestimo.status, 400);

    const dataSemDevolucao = await call("PATCH", `/api/movements/${emprestimo.id}`, {
      returned_at: "2030-01-01T00:00:00.000Z"
    });
    assert.equal(dataSemDevolucao.status, 400);

    // Trocar o tipo continua ajustando o status automaticamente (comportamento existente).
    const virouFixo = await call("PATCH", `/api/movements/${emprestimo.id}`, { movement_type: "instalacao_fixa" });
    assert.equal(virouFixo.status, 200);
    assert.equal(virouFixo.body.item.status, "fixo");
  });

  it("responde 400 (e não 500) para setor ou equipamento inexistente", async () => {
    await setup();

    const setor = await call("POST", "/api/movements", { ...baseMovement, sector_id: 9999 });
    assert.equal(setor.status, 400);

    const equipamento = await call("POST", "/api/movements", { ...baseMovement, equipment_id: 9999 });
    assert.equal(equipamento.status, 400);

    const local = await call("POST", "/api/catalogs/locations", { name: "Sala X", sector_id: 9999 });
    assert.equal(local.status, 400);
  });

  it("bloqueia saída de equipamento descartado, inativo ou que já está fora", async () => {
    await setup();

    const descartado = (
      await call("POST", "/api/catalogs/equipments", { name: "Notebook Velho", condition_status: "descartado" })
    ).body.item;
    const r1 = await call("POST", "/api/movements", {
      ...baseMovement,
      equipment_id: descartado.id,
      equipment_name: descartado.name
    });
    assert.equal(r1.status, 400);

    const inativo = (await call("POST", "/api/catalogs/equipments", { name: "Monitor Antigo" })).body.item;
    await call("PATCH", `/api/catalogs/equipments/${inativo.id}`, { active: false });
    const r2 = await call("POST", "/api/movements", { ...baseMovement, equipment_id: inativo.id, equipment_name: inativo.name });
    assert.equal(r2.status, 400);

    const notebook = (await call("POST", "/api/catalogs/equipments", { name: "Notebook", patrimony: "PAT-1" })).body.item;
    const primeiro = await call("POST", "/api/movements", {
      ...baseMovement,
      equipment_id: notebook.id,
      equipment_name: notebook.name
    });
    assert.equal(primeiro.status, 201);
    assert.equal(primeiro.body.item.patrimony, "PAT-1", "patrimônio herdado do catálogo");

    const segundo = await call("POST", "/api/movements", {
      ...baseMovement,
      sector_name: "Financeiro",
      equipment_id: notebook.id,
      equipment_name: notebook.name
    });
    assert.equal(segundo.status, 409);

    await call("POST", `/api/movements/${primeiro.body.item.id}/return`, {});
    const depoisDaDevolucao = await call("POST", "/api/movements", {
      ...baseMovement,
      equipment_id: notebook.id,
      equipment_name: notebook.name
    });
    assert.equal(depoisDaDevolucao.status, 201);

    // Reabrir a movimentação antiga agora conflita com a nova.
    const reabrir = await call("PATCH", `/api/movements/${primeiro.body.item.id}`, { status: "ativo" });
    assert.equal(reabrir.status, 409);
  });

  it("sincronização: operação inválida não derruba o lote e edições offline seguidas são aplicadas", async () => {
    await setup();

    const lote = await call("POST", "/api/sync", {
      operations: [
        { op_id: "ok", type: "sector.create", payload: { name: "Financeiro" } },
        { op_id: "ruim", type: "movement.create", payload: { equipment_name: "X", sector_name: "Y", install_location: "" } }
      ]
    });
    assert.equal(lote.status, 200);
    assert.deepEqual(
      lote.body.results.map((r: { op_id: string; status: string }) => [r.op_id, r.status]),
      [
        ["ok", "applied"],
        ["ruim", "error"]
      ]
    );

    const mov = (await call("POST", "/api/movements", baseMovement)).body.item;
    // O frontend agora incrementa a versão local a cada operação enfileirada.
    const seguidas = await call("POST", "/api/sync", {
      operations: [
        { op_id: "e1", type: "movement.update", entity_id: mov.id, payload: { notes: "edição 1", expected_version: mov.version } },
        { op_id: "e2", type: "movement.return", entity_id: mov.id, payload: { expected_version: mov.version + 1 } }
      ]
    });
    assert.deepEqual(
      seguidas.body.results.map((r: { status: string }) => r.status),
      ["applied", "applied"]
    );
  });

  it("não sugere setores desativados vindos do histórico", async () => {
    await setup();

    const setor = (await call("POST", "/api/catalogs/sectors", { name: "Almoxarifado" })).body.item;
    await call("POST", "/api/movements", { ...baseMovement, sector_name: "Almoxarifado", sector_id: setor.id });
    await call("PATCH", `/api/catalogs/sectors/${setor.id}`, { active: false });

    const sugestoes = await call("GET", "/api/catalogs/suggestions");
    assert.equal(
      sugestoes.body.sectors.some((s: { name: string }) => s.name === "Almoxarifado"),
      false
    );
  });

  it("situação do equipamento acompanha saída, troca de tipo e devolução", async () => {
    await setup();

    const eq = (await call("POST", "/api/catalogs/equipments", { name: "Projetor", patrimony: "PJ-1" })).body.item;
    const mov = (
      await call("POST", "/api/movements", { ...baseMovement, equipment_id: eq.id, equipment_name: eq.name })
    ).body.item;
    const situacao = async () => (await call("GET", `/api/catalogs/equipments/${eq.id}`)).body.item.condition_status;

    assert.equal(await situacao(), "emprestado");

    // Edição manual da situação com movimentação aberta é bloqueada.
    const manual = await call("PATCH", `/api/catalogs/equipments/${eq.id}`, { condition_status: "disponivel" });
    assert.equal(manual.status, 409);
    const desativar = await call("PATCH", `/api/catalogs/equipments/${eq.id}`, { active: false });
    assert.equal(desativar.status, 409);

    await call("PATCH", `/api/movements/${mov.id}`, { movement_type: "instalacao_fixa" });
    assert.equal(await situacao(), "em_uso");

    // Desfazer a instalação fixa devolve o equipamento.
    const desfeita = await call("POST", `/api/movements/${mov.id}/return`, {});
    assert.equal(desfeita.status, 200);
    assert.equal(await situacao(), "disponivel");

    // "Emprestado" não pode ser definido à mão.
    const emprestadoManual = await call("PATCH", `/api/catalogs/equipments/${eq.id}`, { condition_status: "emprestado" });
    assert.equal(emprestadoManual.status, 400);
  });

  it("bloqueia empréstimo de equipamento em manutenção ou avaliação", async () => {
    await setup();
    for (const condition_status of ["manutencao", "avaliacao"]) {
      const eq = (await call("POST", "/api/catalogs/equipments", { name: `Item ${condition_status}`, condition_status })).body
        .item;
      const res = await call("POST", "/api/movements", { ...baseMovement, equipment_id: eq.id, equipment_name: eq.name });
      assert.equal(res.status, 400, condition_status);
    }
  });

  it("aplica prazo padrão de devolução e lista atrasados", async () => {
    await setup();

    const settings = await call("PATCH", "/api/settings", { loan_default_days: 3 });
    assert.equal(settings.body.settings.loan_default_days, 3);

    const outAt = "2026-01-10T12:00:00.000Z";
    const comPrazo = (await call("POST", "/api/movements", { ...baseMovement, out_at: outAt })).body.item;
    assert.equal(comPrazo.due_at, "2026-01-13T12:00:00.000Z");

    const semPrazo = (await call("POST", "/api/movements", { ...baseMovement, equipment_name: "Cabo", due_at: null })).body
      .item;
    assert.equal(semPrazo.due_at, null);

    const fixa = (
      await call("POST", "/api/movements", { ...baseMovement, equipment_name: "Rack", movement_type: "instalacao_fixa" })
    ).body.item;
    assert.equal(fixa.due_at, null, "instalação fixa não tem prazo");

    const prazoAntes = await call("POST", "/api/movements", {
      ...baseMovement,
      out_at: outAt,
      due_at: "2026-01-09T00:00:00.000Z"
    });
    assert.equal(prazoAntes.status, 400);

    const atrasados = await call("GET", "/api/movements?overdue=true");
    assert.deepEqual(
      atrasados.body.items.map((m: { id: number }) => m.id),
      [comPrazo.id]
    );
  });

  it("devolve equipamento de terceiro ao dono", async () => {
    await setup();

    const proprio = (await call("POST", "/api/catalogs/equipments", { name: "Switch" })).body.item;
    const naoTerceiro = await call("POST", `/api/catalogs/equipments/${proprio.id}/return-to-owner`, {
      received_by: "Maria"
    });
    assert.equal(naoTerceiro.status, 400);

    const terceiro = (
      await call("POST", "/api/catalogs/equipments", { name: "Notebook do Financeiro", ownership_type: "terceiro" })
    ).body.item;
    const mov = (
      await call("POST", "/api/movements", { ...baseMovement, equipment_id: terceiro.id, equipment_name: terceiro.name })
    ).body.item;

    const comMovimentacaoAberta = await call("POST", `/api/catalogs/equipments/${terceiro.id}/return-to-owner`, {
      received_by: "Maria"
    });
    assert.equal(comMovimentacaoAberta.status, 409);

    await call("POST", `/api/movements/${mov.id}/return`, {});
    const ok = await call("POST", `/api/catalogs/equipments/${terceiro.id}/return-to-owner`, {
      received_by: "Maria",
      notes: "Consertado"
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.item.condition_status, "devolvido_dono");
    assert.equal(ok.body.item.active, 0);
    assert.equal(ok.body.item.owner_received_by, "Maria");

    const depois = await call("POST", "/api/movements", {
      ...baseMovement,
      equipment_id: terceiro.id,
      equipment_name: terceiro.name
    });
    assert.equal(depois.status, 400, "não pode mais sair");
  });

  it("logout invalida o token copiado e logout-all encerra todas as sessões", async () => {
    await setup();
    const tokenCopiado = cookie;

    const logout = await app!.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: tokenCopiado } });
    assert.equal(logout.statusCode, 200);
    const reuso = await app!.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: tokenCopiado } });
    assert.equal(reuso.statusCode, 401, "token não vale mais depois do logout");

    const login1 = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "tecnico1", password: "tecnico1-nova-senha-2026" }
    });
    const login2 = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "tecnico1", password: "tecnico1-nova-senha-2026" }
    });
    const c1 = extractCookie(login1.headers["set-cookie"]);
    const c2 = extractCookie(login2.headers["set-cookie"]);
    await app!.inject({ method: "POST", url: "/api/auth/logout-all", headers: { cookie: c1 } });
    const outro = await app!.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: c2 } });
    assert.equal(outro.statusCode, 401);
  });

  it("exige senha de no mínimo 8 caracteres também ao criar usuário", async () => {
    await setup();
    const curta = await call("POST", "/api/users", { full_name: "Fulano", username: "fulano", password: "123456" });
    assert.equal(curta.status, 400);
  });

  it("pagina a auditoria por cursor", async () => {
    await setup();
    for (let i = 0; i < 5; i++) {
      await call("POST", "/api/catalogs/sectors", { name: `Setor ${i}` });
    }
    const p1 = await call("GET", "/api/audit?entity=catalog_sector&limit=2");
    assert.equal(p1.body.items.length, 2);
    assert.ok(p1.body.next_before_id);
    const p2 = await call("GET", `/api/audit?entity=catalog_sector&limit=2&before_id=${p1.body.next_before_id}`);
    const p3 = await call("GET", `/api/audit?entity=catalog_sector&limit=2&before_id=${p2.body.next_before_id}`);
    const ids = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((i: { id: number }) => i.id);
    assert.equal(new Set(ids).size, 5);
    assert.equal(p3.body.next_before_id, null);
  });

  it("gera backup do banco somente com a senha correta", async () => {
    await setup();
    const errada = await app!.inject({
      method: "POST",
      url: "/api/backup",
      headers: { cookie },
      payload: { password: "senha-errada" }
    });
    assert.equal(errada.statusCode, 400);

    const ok = await app!.inject({
      method: "POST",
      url: "/api/backup",
      headers: { cookie },
      payload: { password: "tecnico1-nova-senha-2026" }
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.rawPayload.subarray(0, 15).toString(), "SQLite format 3");
  });

  it("não deixa X-Forwarded-For forjado contornar o rate limit de login por padrão", async () => {
    await setup({ loginRateLimitMax: 3 });

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app!.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "x-forwarded-for": `10.0.0.${i}` },
        payload: { username: "tecnico1", password: "errada" }
      });
      statuses.push(res.statusCode);
    }
    assert.ok(statuses.includes(429), `esperado 429, recebido ${statuses.join(",")}`);
  });
});
