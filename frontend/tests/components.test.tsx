import "./setupDom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CategorySelector } from "../src/components/SectorSelector";
import { EquipamentosPage } from "../src/pages/EquipamentosPage";
import { LoginPage } from "../src/pages/LoginPage";
import { MovimentacoesPage } from "../src/pages/MovimentacoesPage";
import { ApiError } from "../src/services/api";
import type {
  CatalogCategory,
  CatalogEquipment,
  CatalogLocation,
  CatalogSector,
  MovementItem,
  PublicSettings,
  SuggestionsPayload
} from "../src/types";

const NOW = "2026-11-10T10:00:00.000Z";

function makeEquipment(overrides?: Partial<CatalogEquipment>): CatalogEquipment {
  return {
    id: 1,
    client_uuid: "eq-uuid-1",
    name: "Notebook Dell 5430",
    patrimony: "PAT-100",
    category_id: 1,
    category: "Notebook",
    ownership_type: "proprio_ti",
    condition_status: "disponivel",
    origin_sector_id: null,
    origin: "",
    received_from: "",
    received_at: NOW,
    reason: "",
    notes: "",
    active: 1,
    version: 1,
    created_by_id: 1,
    created_by_name: "Admin",
    updated_by_id: 1,
    updated_by_name: "Admin",
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  };
}

function makeSector(overrides?: Partial<CatalogSector>): CatalogSector {
  return {
    id: 1,
    name: "Secretaria Acadêmica",
    is_default: 0,
    active: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  };
}

function makeCategory(overrides?: Partial<CatalogCategory>): CatalogCategory {
  return {
    id: 1,
    name: "Notebook",
    is_default: 0,
    active: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  };
}

function makeLocation(overrides?: Partial<CatalogLocation>): CatalogLocation {
  return {
    id: 1,
    name: "Sala 104",
    sector_id: 1,
    sector_name: "Secretaria Acadêmica",
    active: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  };
}

function makeMovement(overrides?: Partial<MovementItem>): MovementItem {
  return {
    id: 10,
    client_uuid: "mov-uuid-10",
    document_code: "MOV-0010",
    movement_type: "emprestimo",
    equipment_id: 2,
    equipment_name: "Projetor Epson",
    patrimony: "PAT-200",
    sector_id: 1,
    sector_name: "Secretaria Acadêmica",
    install_location: "Auditório",
    received_by: "Maria",
    status: "ativo",
    notes: "",
    out_at: NOW,
    due_at: "2020-01-01T23:59:59.000Z",
    returned_at: null,
    registered_by_id: 1,
    registered_by_name: "Técnico",
    returned_to_id: null,
    returned_to_name: null,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  };
}

const emptySuggestions: SuggestionsPayload = {
  equipments: [],
  sectors: [],
  categories: [],
  locations: ["Balcão Central"],
  people: ["João"]
};

const publicSettings: PublicSettings = {
  app_name: "twCIN",
  org_name: "CIN TI",
  org_subtitle: "",
  org_document: "",
  org_contact: "",
  loan_term_footer: "",
  logo_data_url: "",
  theme_preset: "cin",
  brand_color: "#002d6b",
  accent_color: "#c81018",
  bg_color: "",
  bg_image_data_url: "",
  bg_overlay_opacity: 85
};

describe("twCIN Frontend — testes de componentes e interação", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("MovimentacoesPage: abre modal de nova movimentação, bloqueia item em manutenção e envia payload", async () => {
    const created: unknown[] = [];
    const eqOk = makeEquipment({ id: 1, client_uuid: "eq-1", name: "Latitude 5430", patrimony: "PAT-01" });
    const eqMaint = makeEquipment({
      id: 2,
      client_uuid: "eq-2",
      name: "Switch Defeito",
      patrimony: "PAT-02",
      condition_status: "manutencao"
    });
    const sector = makeSector({ id: 5, name: "Coordenação" });

    render(
      <MovimentacoesPage
        items={[]}
        equipments={[eqOk, eqMaint]}
        sectors={[sector]}
        locations={[makeLocation({ id: 1, name: "Sala 201", sector_id: 5 })]}
        suggestions={emptySuggestions}
        online
        loanDefaultDays={7}
        onCreate={async (payload) => {
          created.push(payload);
        }}
        onUpdate={async () => {}}
        onReturn={async () => {}}
        onCreateSector={async (p) => makeSector({ id: 9, name: p.name })}
        onPrintSingle={() => {}}
        onPrintList={() => {}}
        onOpenAudit={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Nova movimentação/i }));
    const dialog = screen.getByRole("dialog", { name: /Nova movimentação/i });

    const equipInput = within(dialog).getByLabelText(/Equipamento/i);
    fireEvent.focus(equipInput);

    const maintOption = within(dialog).getByRole("option", { name: /Switch Defeito/i });
    assert.equal(maintOption.hasAttribute("disabled"), true);

    const okOption = within(dialog).getByRole("option", { name: /Latitude 5430/i });
    fireEvent.click(okOption);

    const sectorTrigger = within(dialog).getByRole("button", { name: /Setor de destino/i });
    fireEvent.click(sectorTrigger);
    fireEvent.click(within(dialog).getByRole("option", { name: "Coordenação" }));

    const locInput = within(dialog).getByLabelText(/Local de instalação/i);
    fireEvent.change(locInput, { target: { value: "Sala 201" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /Registrar saída/i }));

    await waitFor(() => assert.equal(created.length, 1));
    assert.deepEqual(
      {
        equipment_id: (created[0] as Record<string, unknown>).equipment_id,
        equipment_name: (created[0] as Record<string, unknown>).equipment_name,
        sector_id: (created[0] as Record<string, unknown>).sector_id,
        sector_name: (created[0] as Record<string, unknown>).sector_name,
        install_location: (created[0] as Record<string, unknown>).install_location
      },
      {
        equipment_id: 1,
        equipment_name: "Latitude 5430",
        sector_id: 5,
        sector_name: "Coordenação",
        install_location: "Sala 201"
      }
    );
  });

  it("MovimentacoesPage: filtra atrasados, exibe erro ao falhar devolução e confirma devolução", async () => {
    const returned: string[] = [];
    let shouldFail = true;

    const overdueMov = makeMovement({
      id: 10,
      client_uuid: "mov-overdue",
      document_code: "MOV-0010",
      equipment_name: "Projetor Atrasado",
      sector_name: "Auditório"
    });
    const onTimeMov = makeMovement({
      id: 11,
      client_uuid: "mov-ontime",
      document_code: "MOV-0011",
      equipment_name: "Monitor Em Dia",
      due_at: "2099-01-01T23:59:59.000Z"
    });

    render(
      <MovimentacoesPage
        items={[overdueMov, onTimeMov]}
        equipments={[]}
        sectors={[makeSector({ id: 1, name: "Auditório" })]}
        locations={[]}
        suggestions={emptySuggestions}
        online={false}
        loanDefaultDays={7}
        onCreate={async () => {}}
        onUpdate={async () => {}}
        onReturn={async (item) => {
          if (shouldFail) throw new Error("Falha simulada ao devolver");
          returned.push(item.document_code);
        }}
        onCreateSector={async (p) => makeSector({ name: p.name })}
        onPrintSingle={() => {}}
        onPrintList={() => {}}
        onOpenAudit={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Atrasados \(1\)$/i }));
    assert.ok(screen.getByText("Projetor Atrasado"));
    assert.equal(screen.queryByText("Monitor Em Dia"), null);

    fireEvent.click(screen.getByRole("button", { name: /Registrar devolução/i }));
    const confirmDialog = screen.getByRole("dialog", { name: /Registrar devolução\?/i });

    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => {
      assert.ok(within(confirmDialog).getByRole("alert").textContent?.includes("Falha simulada ao devolver"));
    });

    shouldFail = false;
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => assert.deepEqual(returned, ["MOV-0010"]));

    fireEvent.click(screen.getByRole("tab", { name: "Registros" }));
    assert.ok(screen.getByText(/Você está offline/i));
  });

  it("CategorySelector: busca, autocompleta, confirma criação em modal e trata erro de criação", async () => {
    let selectedValue = "";
    let failCreate = true;
    const createdNames: string[] = [];

    const Wrapper = () => {
      return (
        <div>
          <label htmlFor="cat-test">Categoria</label>
          <CategorySelector
            id="cat-test"
            value={selectedValue}
            onChange={(next) => {
              selectedValue = next;
            }}
            categories={[
              makeCategory({ id: 1, name: "Notebook", is_default: 1 }),
              makeCategory({ id: 2, name: "Projetor" })
            ]}
            suggestedNames={["Periférico"]}
            onCreateCategory={async ({ name }) => {
              if (failCreate) throw new Error("Categoria duplicada");
              createdNames.push(name);
              return makeCategory({ id: 3, name });
            }}
          />
        </div>
      );
    };

    const { rerender } = render(<Wrapper />);

    fireEvent.click(screen.getByRole("button", { name: "Categoria" }));
    fireEvent.change(screen.getByLabelText(/Pesquisar categoria/i), { target: { value: "proj" } });
    assert.ok(screen.getByRole("option", { name: "Projetor" }));
    assert.equal(screen.queryByRole("option", { name: /Notebook/i }), null);

    fireEvent.click(screen.getByRole("option", { name: /Digitar manualmente/i }));
    const manualInput = screen.getByLabelText("Categoria");
    fireEvent.change(manualInput, { target: { value: "Perif" } });
    selectedValue = "Perif";
    rerender(<Wrapper />);

    assert.ok(screen.getByRole("button", { name: "Periférico" }));

    fireEvent.click(screen.getByRole("button", { name: /Criar categoria/i }));
    const confirmModal = screen.getByRole("dialog", { name: /Confirmar criação de categoria/i });
    fireEvent.click(within(confirmModal).getByRole("button", { name: /Sim, criar categoria/i }));

    await waitFor(() => {
      assert.ok(within(confirmModal).getByRole("alert").textContent?.includes("Categoria duplicada"));
    });

    failCreate = false;
    fireEvent.click(within(confirmModal).getByRole("button", { name: /Sim, criar categoria/i }));
    await waitFor(() => assert.deepEqual(createdNames, ["Perif"]));
  });

  it("EquipamentosPage: filtra por categoria e cadastra equipamento novo", async () => {
    const created: Array<Record<string, unknown>> = [];
    const eq1 = makeEquipment({ id: 1, client_uuid: "e1", name: "ThinkPad X1", category_id: 1, category: "Notebook" });
    const eq2 = makeEquipment({ id: 2, client_uuid: "e2", name: "Epson L3250", category_id: 2, category: "Impressora" });

    render(
      <EquipamentosPage
        equipments={[eq1, eq2]}
        movements={[]}
        sectors={[makeSector({ id: 1, name: "TI" })]}
        categories={[
          makeCategory({ id: 1, name: "Notebook", is_default: 1 }),
          makeCategory({ id: 2, name: "Impressora" })
        ]}
        suggestions={emptySuggestions}
        onCreate={async (payload) => {
          created.push(payload);
        }}
        onUpdate={async () => {}}
        onReturnToOwner={async () => {}}
        onCreateSector={async (p) => makeSector({ id: 8, name: p.name })}
        onCreateCategory={async (p) => makeCategory({ id: 8, name: p.name })}
        onOpenAudit={() => {}}
        onPrintReport={() => {}}
        onPrintReceipt={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText("Filtrar por categoria"), { target: { value: "Impressora" } });
    assert.ok(screen.getByText("Epson L3250"));
    assert.equal(screen.queryByText("ThinkPad X1"), null);

    fireEvent.click(screen.getByRole("button", { name: /Novo equipamento/i }));
    const modal = screen.getByRole("dialog", { name: /Novo equipamento/i });
    fireEvent.change(within(modal).getByLabelText(/^Nome/i), { target: { value: "Dell U2422H" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Cadastrar" }));

    await waitFor(() => assert.equal(created.length, 1));
    assert.equal(created[0].name, "Dell U2422H");
    assert.equal(created[0].category, "Notebook");
  });

  it("LoginPage: valida senha inicial curta e exibe erro retornado pela API no login", async () => {
    let setupCalls = 0;
    const { rerender } = render(
      <LoginPage
        needsSetup
        settings={publicSettings}
        onLogin={async () => {}}
        onSetupInitial={async () => {
          setupCalls += 1;
        }}
        onRestoreInitial={async () => ({ restored_users: 0, restored_equipments: 0, restored_movements: 0 })}
      />
    );

    fireEvent.change(screen.getByLabelText(/Seu nome completo/i), { target: { value: "Admin TI" } });
    fireEvent.change(screen.getByLabelText(/Usuário/i), { target: { value: "adminti" } });
    fireEvent.change(screen.getByLabelText(/Senha/i), { target: { value: "123" } });
    fireEvent.submit(screen.getByRole("button", { name: /Criar primeiro usuário/i }).closest("form")!);

    await waitFor(() => {
      assert.ok(screen.getByRole("alert").textContent?.includes("mínimo 8 caracteres"));
    });
    assert.equal(setupCalls, 0);

    rerender(
      <LoginPage
        needsSetup={false}
        settings={publicSettings}
        onLogin={async () => {
          throw new ApiError("Usuário ou senha inválidos.", 401);
        }}
        onSetupInitial={async () => {}}
        onRestoreInitial={async () => ({ restored_users: 0, restored_equipments: 0, restored_movements: 0 })}
      />
    );

    fireEvent.change(screen.getByLabelText(/Usuário/i), { target: { value: "tecnico1" } });
    fireEvent.change(screen.getByLabelText(/Senha/i), { target: { value: "errada" } });
    fireEvent.submit(screen.getByRole("button", { name: "Entrar" }).closest("form")!);

    await waitFor(() => {
      assert.ok(screen.getByRole("alert").textContent?.includes("Usuário ou senha inválidos."));
    });
  });
});
