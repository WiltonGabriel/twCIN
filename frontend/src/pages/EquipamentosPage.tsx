import { Eye, FileText, History, Pencil, Plus, Printer, Undo2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { PageIntro } from "../components/PageIntro";
import { findCatalogSector, SectorSelector } from "../components/SectorSelector";
import { apiRequest } from "../services/api";
import type {
  CatalogEquipment,
  CatalogSector,
  EquipmentCondition,
  EquipmentOwnership,
  MovementItem,
  SuggestionsPayload
} from "../types";
import {
  CONDITION_LABELS,
  conditionStyle,
  formatDate,
  formatDateTime,
  isOverdue,
  MANUAL_CONDITIONS,
  movementStatusLabel,
  movementStatusStyle,
  OWNERSHIP_LABELS
} from "../types/labels";
import { isoToLocalDate, isoToLocalTime, localDate, localTime, toIso } from "../utils/dateInput";
import { collectSectorFilterOptions, matchEquipmentSector } from "../utils/sectorFilters";

type EquipmentPayload = {
  name: string;
  patrimony: string;
  category: string;
  ownership_type: EquipmentOwnership;
  condition_status: EquipmentCondition;
  origin_sector_id: number | null;
  origin: string;
  received_from: string;
  received_at?: string;
  reason: string;
  notes: string;
};

type EquipmentFormState = EquipmentPayload & {
  autoNow: boolean;
  receivedDate: string;
  receivedTime: string;
};

interface EquipamentosPageProps {
  equipments: CatalogEquipment[];
  movements: MovementItem[];
  sectors: CatalogSector[];
  suggestions: SuggestionsPayload;
  onCreate: (payload: EquipmentPayload) => Promise<void>;
  onUpdate: (item: CatalogEquipment, patch: Partial<EquipmentPayload & { active: boolean }>) => Promise<void>;
  onReturnToOwner: (
    item: CatalogEquipment,
    input: { received_by: string; returned_at?: string; notes?: string }
  ) => Promise<void>;
  onCreateSector: (payload: { name: string; is_default?: boolean }) => Promise<CatalogSector>;
  onOpenAudit: (item: CatalogEquipment) => void;
  onPrintReport: (items: CatalogEquipment[], title?: string) => void;
  onPrintReceipt: (item: CatalogEquipment) => void;
}

type Filter =
  | "all"
  | "disponiveis"
  | "fora"
  | "atencao"
  | EquipmentOwnership
  | "devolvidos_dono"
  | "inactive";

function emptyEquipmentForm(): EquipmentFormState {
  const now = new Date();
  return {
    name: "",
    patrimony: "",
    category: "",
    ownership_type: "proprio_ti",
    condition_status: "disponivel",
    origin_sector_id: null,
    origin: "",
    received_from: "",
    reason: "",
    notes: "",
    autoNow: true,
    receivedDate: localDate(now),
    receivedTime: localTime(now)
  };
}

function formFromEquipment(eq: CatalogEquipment): EquipmentFormState {
  const rec = eq.received_at || eq.created_at;
  return {
    name: eq.name,
    patrimony: eq.patrimony || "",
    category: eq.category,
    ownership_type: eq.ownership_type,
    condition_status: eq.condition_status,
    origin_sector_id: eq.origin_sector_id ?? null,
    origin: eq.origin,
    received_from: eq.received_from,
    received_at: rec,
    reason: eq.reason,
    notes: eq.notes,
    autoNow: false,
    receivedDate: isoToLocalDate(rec),
    receivedTime: isoToLocalTime(rec)
  };
}

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const handler = () => onClose();
    d.addEventListener("close", handler);
    return () => d.removeEventListener("close", handler);
  }, [onClose]);
  return ref;
}

function EquipmentFormFields({
  idPrefix,
  value,
  onChange,
  sectors,
  suggestions,
  onCreateSector,
  allowAutoNow,
  lockedCondition
}: {
  idPrefix: string;
  value: EquipmentFormState;
  onChange: (v: EquipmentFormState) => void;
  sectors: CatalogSector[];
  suggestions: SuggestionsPayload;
  onCreateSector: (payload: { name: string; is_default?: boolean }) => Promise<CatalogSector>;
  allowAutoNow: boolean;
  /** Motivo pelo qual a situação não pode ser alterada agora (ex.: está emprestado). */
  lockedCondition?: string;
}) {
  const peopleListId = useId();
  const set = <K extends keyof EquipmentFormState>(key: K, v: EquipmentFormState[K]) =>
    onChange({ ...value, [key]: v });
  const conditionOptions = MANUAL_CONDITIONS.includes(value.condition_status)
    ? MANUAL_CONDITIONS
    : [value.condition_status, ...MANUAL_CONDITIONS];

  const handleOriginChange = (name: string) => {
    const matched = findCatalogSector(sectors, name);
    onChange({
      ...value,
      origin: name,
      origin_sector_id: matched && matched.id > 0 ? matched.id : null
    });
  };

  const originContent = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label htmlFor={`${idPrefix}-origin`} className="tw-label">
          {value.ownership_type === "terceiro" ? "Setor / origem *" : "Setor doador / origem (opcional)"}
        </label>
        <SectorSelector
          id={`${idPrefix}-origin`}
          value={value.origin}
          onChange={handleOriginChange}
          sectors={sectors}
          suggestedNames={suggestions.sectors.map((s) => s.name)}
          onCreateSector={async (secPayload) => {
            const created = await onCreateSector(secPayload);
            onChange({
              ...value,
              origin: created.name,
              origin_sector_id: created.id > 0 ? created.id : null
            });
            return created;
          }}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-from`} className="tw-label">Entregue por (pessoa)</label>
        <input
          id={`${idPrefix}-from`}
          list={peopleListId}
          value={value.received_from}
          onChange={(e) => set("received_from", e.target.value)}
          placeholder="Quem entregou na TI"
          className="tw-input"
        />
        <datalist id={peopleListId}>
          {suggestions.people.map((person) => (
            <option key={person} value={person} />
          ))}
        </datalist>
      </div>
      <div className="sm:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <span className="tw-label mb-0">Data/hora do recebimento na TI</span>
          {allowAutoNow && (
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={value.autoNow}
                onChange={(e) => set("autoNow", e.target.checked)}
              />
              <span>Agora (horário do envio)</span>
            </label>
          )}
        </div>
        {!value.autoNow && (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              aria-label="Data de recebimento na TI"
              value={value.receivedDate}
              onChange={(e) => set("receivedDate", e.target.value)}
              className="tw-input"
              required
            />
            <input
              type="time"
              aria-label="Hora de recebimento na TI"
              value={value.receivedTime}
              onChange={(e) => set("receivedTime", e.target.value)}
              className="tw-input"
              required
            />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-name`} className="tw-label">Nome <span aria-hidden="true">*</span></label>
        <input id={`${idPrefix}-name`} required value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Notebook Dell Latitude 5420" className="tw-input" />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-pat`} className="tw-label">Nº do patrimônio</label>
        <input id={`${idPrefix}-pat`} value={value.patrimony} onChange={(e) => set("patrimony", e.target.value)} placeholder="PAT-0000" className="tw-input font-mono" />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-cat`} className="tw-label">Categoria</label>
        <input id={`${idPrefix}-cat`} value={value.category} onChange={(e) => set("category", e.target.value)} placeholder="Notebook, monitor, projetor..." className="tw-input" />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-own`} className="tw-label">Posse</label>
        <select id={`${idPrefix}-own`} value={value.ownership_type} onChange={(e) => set("ownership_type", e.target.value as EquipmentOwnership)} className="tw-input">
          {(Object.keys(OWNERSHIP_LABELS) as EquipmentOwnership[]).map((k) => <option key={k} value={k}>{OWNERSHIP_LABELS[k]}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-cond`} className="tw-label">Situação</label>
        <select
          id={`${idPrefix}-cond`}
          value={value.condition_status}
          disabled={Boolean(lockedCondition)}
          onChange={(e) => set("condition_status", e.target.value as EquipmentCondition)}
          className="tw-input"
        >
          {conditionOptions.map((k) => (
            <option key={k} value={k} disabled={!MANUAL_CONDITIONS.includes(k)}>{CONDITION_LABELS[k]}</option>
          ))}
        </select>
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {lockedCondition ?? "\"Emprestado\" é definido somente pelas movimentações; \"Em uso\" pode ser marcado manualmente ou por instalação fixa."}
        </p>
      </div>

      {value.ownership_type === "terceiro" ? (
        <fieldset className="sm:col-span-2 p-3 rounded-xl border space-y-2" style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}>
          <legend className="text-xs font-semibold px-1">Origem e recebimento na TI</legend>
          {originContent}
        </fieldset>
      ) : (
        <details
          className="sm:col-span-2 p-3 rounded-xl border"
          style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
          open={Boolean(value.origin || value.received_from)}
        >
          <summary className="text-xs font-semibold cursor-pointer">
            Procedência / recebimento na TI (opcional — doação ou repasse de setor)
          </summary>
          <div className="mt-3">{originContent}</div>
        </details>
      )}

      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-reason`} className="tw-label">Motivo de estar com o TI</label>
        <input id={`${idPrefix}-reason`} value={value.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Reserva técnica, doação de setor, formatação, conserto..." className="tw-input" />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-notes`} className="tw-label">Observações</label>
        <textarea id={`${idPrefix}-notes`} value={value.notes} onChange={(e) => set("notes", e.target.value)} className="tw-textarea" />
      </div>
    </div>
  );
}

export function EquipamentosPage({
  equipments,
  movements,
  sectors,
  suggestions,
  onCreate,
  onUpdate,
  onReturnToOwner,
  onCreateSector,
  onOpenAudit,
  onPrintReport,
  onPrintReceipt
}: EquipamentosPageProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<EquipmentFormState | null>(null);
  const [editing, setEditing] = useState<{ item: CatalogEquipment; fields: EquipmentFormState; active: boolean } | null>(null);
  const [details, setDetails] = useState<CatalogEquipment | null>(null);
  const [detailMovements, setDetailMovements] = useState<MovementItem[]>([]);
  const [returning, setReturning] = useState<{
    item: CatalogEquipment;
    receivedBy: string;
    autoNow: boolean;
    returnedDate: string;
    returnedTime: string;
    notes: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createRef = useDialog(Boolean(creating), () => setCreating(null));
  const editRef = useDialog(Boolean(editing), () => setEditing(null));
  const detailsRef = useDialog(Boolean(details), () => setDetails(null));
  const returnRef = useDialog(Boolean(returning), () => setReturning(null));

  /** Movimentação em aberto de cada equipamento ("onde está agora"). */
  const openByEquipment = useMemo(() => {
    const map = new Map<number, MovementItem>();
    for (const m of movements) {
      if (m.equipment_id && (m.status === "ativo" || m.status === "fixo")) map.set(m.equipment_id, m);
    }
    return map;
  }, [movements]);

  const sectorOptions = useMemo(
    () => collectSectorFilterOptions(sectors, equipments, movements),
    [sectors, equipments, movements]
  );
  const selectedSectorOption = useMemo(
    () => sectorOptions.find((s) => s.name === sectorFilter) ?? null,
    [sectorOptions, sectorFilter]
  );

  const active = equipments.filter((e) => e.active === 1);
  const counts = {
    all: active.length,
    disponiveis: active.filter((e) => e.condition_status === "disponivel").length,
    fora: active.filter((e) => openByEquipment.has(e.id)).length,
    atencao: active.filter((e) => e.condition_status === "manutencao" || e.condition_status === "avaliacao").length,
    terceiro: active.filter((e) => e.ownership_type === "terceiro").length,
    devolvidos_dono: equipments.filter((e) => e.condition_status === "devolvido_dono").length,
    inactive: equipments.filter((e) => e.active === 0 && e.condition_status !== "devolvido_dono").length
  };

  const q = search.trim().toLowerCase();
  const filtered = equipments
    .filter((eq) => {
      if (filter === "devolvidos_dono") return eq.condition_status === "devolvido_dono";
      if (filter === "inactive") return eq.active === 0 && eq.condition_status !== "devolvido_dono";
      if (eq.active !== 1) return false;
      if (filter === "disponiveis") return eq.condition_status === "disponivel";
      if (filter === "fora") return openByEquipment.has(eq.id);
      if (filter === "atencao") return eq.condition_status === "manutencao" || eq.condition_status === "avaliacao";
      if (filter === "proprio_ti" || filter === "estoque" || filter === "terceiro") return eq.ownership_type === filter;
      return true;
    })
    .filter((eq) => (!selectedSectorOption ? true : matchEquipmentSector(eq, selectedSectorOption)))
    .filter(
      (eq) =>
        !q ||
        [
          eq.name,
          eq.patrimony || "",
          eq.category,
          eq.origin,
          eq.received_from,
          eq.owner_received_by || "",
          eq.reason,
          eq.notes
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const run = async (action: () => Promise<void>, fallback: string) => {
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setSaving(false);
    }
  };

  const openDetails = async (eq: CatalogEquipment) => {
    setDetails(eq);
    setDetailMovements(movements.filter((m) => m.equipment_id === eq.id));
    if (eq.id > 0 && navigator.onLine) {
      try {
        const res = await apiRequest<{ item: CatalogEquipment; movements: MovementItem[] }>(`/api/catalogs/equipments/${eq.id}`);
        setDetails(res.item);
        setDetailMovements(res.movements);
      } catch {
        // Mantém o histórico local quando offline.
      }
    }
  };

  const openEdit = (eq: CatalogEquipment) => {
    setError(null);
    setEditing({
      item: eq,
      active: eq.active === 1,
      fields: formFromEquipment(eq)
    });
  };

  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!creating) return;
    const payload: EquipmentPayload = {
      name: creating.name,
      patrimony: creating.patrimony,
      category: creating.category,
      ownership_type: creating.ownership_type,
      condition_status: creating.condition_status,
      origin_sector_id: creating.origin_sector_id,
      origin: creating.origin,
      received_from: creating.received_from,
      reason: creating.reason,
      notes: creating.notes
    };
    if (!creating.autoNow) {
      const iso = toIso(creating.receivedDate, creating.receivedTime);
      if (!iso) {
        setError("Data ou hora de recebimento inválida.");
        return;
      }
      payload.received_at = iso;
    }
    void run(async () => {
      await onCreate(payload);
      setCreating(null);
    }, "Erro ao cadastrar equipamento.");
  };

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const { item, fields } = editing;
    const patch: Partial<EquipmentPayload & { active: boolean }> = {};
    if (fields.name !== item.name) patch.name = fields.name;
    if (fields.patrimony !== (item.patrimony || "")) patch.patrimony = fields.patrimony;
    if (fields.category !== item.category) patch.category = fields.category;
    if (fields.ownership_type !== item.ownership_type) patch.ownership_type = fields.ownership_type;
    if (fields.condition_status !== item.condition_status) patch.condition_status = fields.condition_status;
    if (fields.origin_sector_id !== (item.origin_sector_id ?? null)) patch.origin_sector_id = fields.origin_sector_id;
    if (fields.origin !== item.origin) patch.origin = fields.origin;
    if (fields.received_from !== item.received_from) patch.received_from = fields.received_from;
    if (fields.reason !== item.reason) patch.reason = fields.reason;
    if (fields.notes !== item.notes) patch.notes = fields.notes;

    const nextReceivedAt = toIso(fields.receivedDate, fields.receivedTime);
    if (!nextReceivedAt) {
      setError("Data ou hora de recebimento inválida.");
      return;
    }
    if (nextReceivedAt !== (item.received_at || item.created_at)) {
      patch.received_at = nextReceivedAt;
    }
    if (editing.active !== (item.active === 1)) patch.active = editing.active;

    void run(async () => {
      if (Object.keys(patch).length > 0) await onUpdate(item, patch);
      setEditing(null);
    }, "Erro ao salvar equipamento.");
  };

  const submitReturnToOwner = (e: FormEvent) => {
    e.preventDefault();
    if (!returning) return;
    let returnedAt: string | undefined;
    if (!returning.autoNow) {
      const iso = toIso(returning.returnedDate, returning.returnedTime);
      if (!iso) {
        setError("Data ou hora de devolução inválida.");
        return;
      }
      returnedAt = iso;
    }
    void run(async () => {
      await onReturnToOwner(returning.item, {
        received_by: returning.receivedBy,
        returned_at: returnedAt,
        notes: returning.notes || undefined
      });
      setReturning(null);
    }, "Erro ao registrar a devolução ao dono.");
  };

  const filterChip = (key: Filter, label: string, count: number) => (
    <button
      key={key}
      type="button"
      aria-pressed={filter === key}
      onClick={() => setFilter(key)}
      className="px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer"
      style={filter === key ? { backgroundColor: "var(--brand-soft)", borderColor: "var(--brand)", color: "var(--brand)" } : { borderColor: "var(--border)", color: "var(--text-muted)" }}
    >
      {label} ({count})
    </button>
  );

  const whereIs = (eq: CatalogEquipment) => {
    const open = openByEquipment.get(eq.id);
    if (open) {
      return (
        <span>
          {open.sector_name}
          <span className="block text-xs" style={{ color: isOverdue(open) ? "var(--cin-red)" : "var(--text-muted)" }}>
            {open.document_code}
            {open.status === "fixo" ? " · instalado" : open.due_at ? ` · até ${formatDate(open.due_at)}` : ""}
            {isOverdue(open) ? " · atrasado" : ""}
          </span>
        </span>
      );
    }
    if (eq.condition_status === "devolvido_dono") {
      return (
        <span>
          Devolvido ao dono
          <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
            {formatDateTime(eq.owner_returned_at)}
            {eq.owner_received_by ? ` · para ${eq.owner_received_by}` : ""}
          </span>
        </span>
      );
    }
    return <span style={{ color: "var(--text-muted)" }}>Com o TI</span>;
  };

  const errorBox = error && (
    <div role="alert" className="px-3 py-2 rounded-lg text-sm border" style={{ backgroundColor: "var(--cin-red-soft)", borderColor: "var(--cin-red)", color: "var(--cin-red)" }}>
      {error}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageIntro
        title="Equipamentos"
        purpose="Acervo sob responsabilidade do TI: itens próprios, estoque e equipamentos recebidos de outros setores para conserto ou incorporação."
        howTo={[
          "Use \"Novo equipamento\" para cadastrar. Vincule o setor de origem e a data de recebimento para comprovações futuras.",
          "Filtre por setor de origem, situação ou \"Devolvidos ao dono\".",
          "Para itens de terceiros, emita o Comprovante PDF de entrada ou entrega de volta ao setor."
        ]}
        actions={
          <>
            <button
              type="button"
              className="tw-btn"
              onClick={() =>
                onPrintReport(
                  filtered,
                  selectedSectorOption
                    ? `Equipamentos — ${selectedSectorOption.name}`
                    : "Equipamentos sob responsabilidade do TI"
                )
              }
            >
              <Printer className="w-4 h-4" aria-hidden="true" /> PDF
            </button>
            <button type="button" className="tw-btn tw-btn-primary" onClick={() => { setError(null); setCreating(emptyEquipmentForm()); }}>
              <Plus className="w-4 h-4" aria-hidden="true" /> Novo equipamento
            </button>
          </>
        }
      />

      <section className="tw-card p-4 sm:p-5 space-y-4">
        <search className="space-y-3 block">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar equipamentos">
            {filterChip("all", "Todos", counts.all)}
            {filterChip("disponiveis", "Disponíveis", counts.disponiveis)}
            {filterChip("fora", "Fora do TI", counts.fora)}
            {filterChip("atencao", "Manutenção / avaliação", counts.atencao)}
            {filterChip("terceiro", "De terceiros", counts.terceiro)}
            {filterChip("devolvidos_dono", "Devolvidos ao dono", counts.devolvidos_dono)}
            {filterChip("inactive", "Inativos", counts.inactive)}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
            <select
              aria-label="Filtrar por setor de origem"
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="tw-input sm:w-64"
            >
              <option value="all">Todos os setores de origem</option>
              {sectorOptions.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
            <input
              type="search"
              aria-label="Buscar equipamentos"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nome, patrimônio, setor, pessoa..."
              className="tw-input sm:w-80"
            />
          </div>
        </search>

        {filtered.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>
            {equipments.length === 0 ? "Nenhum equipamento cadastrado ainda." : "Nenhum equipamento encontrado com esses filtros."}
          </p>
        ) : (
          <div className="table-wrapper" role="region" aria-label="Lista de equipamentos" tabIndex={0}>
            <table className="tw-table responsive-table">
              <thead>
                <tr>
                  <th scope="col">Equipamento</th>
                  <th scope="col">Patrimônio</th>
                  <th scope="col">Posse / Origem</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Onde está</th>
                  <th scope="col"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((eq) => (
                  <tr key={eq.client_uuid}>
                    <td data-label="Equipamento">
                      <div className="font-semibold">{eq.name}</div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {eq.category || "Sem categoria"}
                        {eq._pendingSync && <span style={{ color: "var(--warn)" }}> · aguardando envio</span>}
                      </div>
                    </td>
                    <td data-label="Patrimônio" className="font-mono text-xs">{eq.patrimony || "-"}</td>
                    <td data-label="Posse / Origem">
                      <div>{OWNERSHIP_LABELS[eq.ownership_type]}</div>
                      {(eq.origin || eq.received_from) && (
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {eq.origin || "Origem não informada"}
                          {eq.received_from ? ` · ${eq.received_from}` : ""}
                        </div>
                      )}
                      {(eq.ownership_type === "terceiro" || eq.origin) && (
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                          Recebido em {formatDate(eq.received_at || eq.created_at)}
                        </div>
                      )}
                    </td>
                    <td data-label="Situação">
                      <span className="tw-badge" style={conditionStyle(eq.condition_status)}>{CONDITION_LABELS[eq.condition_status]}</span>
                    </td>
                    <td data-label="Onde está">{whereIs(eq)}</td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button type="button" className="tw-btn tw-btn-sm" onClick={() => void openDetails(eq)}>
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" /> Detalhes
                        </button>
                        {(eq.ownership_type === "terceiro" || eq.condition_status === "devolvido_dono") && (
                          <button type="button" className="tw-btn tw-btn-sm" onClick={() => onPrintReceipt(eq)}>
                            <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Comprovante
                          </button>
                        )}
                        {eq.condition_status !== "devolvido_dono" && (
                          <button type="button" className="tw-btn tw-btn-sm" onClick={() => openEdit(eq)}>
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Editar
                          </button>
                        )}
                        {eq.id > 0 && (
                          <button type="button" className="tw-btn tw-btn-sm" onClick={() => onOpenAudit(eq)}>
                            <History className="w-3.5 h-3.5" aria-hidden="true" /> Logs
                          </button>
                        )}
                        {eq.ownership_type === "terceiro" && eq.active === 1 && eq.condition_status !== "devolvido_dono" && (
                          <button
                            type="button"
                            className="tw-btn tw-btn-sm"
                            disabled={openByEquipment.has(eq.id)}
                            title={openByEquipment.has(eq.id) ? "Registre a devolução da movimentação antes" : undefined}
                            onClick={() => {
                              setError(null);
                              const now = new Date();
                              setReturning({
                                item: eq,
                                receivedBy: eq.received_from,
                                autoNow: true,
                                returnedDate: localDate(now),
                                returnedTime: localTime(now),
                                notes: ""
                              });
                            }}
                          >
                            <Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> Devolver ao dono
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Novo */}
      <dialog ref={createRef} aria-labelledby="new-eq-title" className="m-auto w-[min(96vw,660px)] max-h-[92vh] rounded-xl p-0 overflow-auto shadow-xl">
        {creating && (
          <form onSubmit={submitCreate} className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
              <h2 id="new-eq-title" className="text-base font-semibold">Novo equipamento</h2>
              <button type="button" aria-label="Fechar" className="tw-btn tw-btn-sm" onClick={() => setCreating(null)}><X className="w-4 h-4" /></button>
            </div>
            <EquipmentFormFields
              idPrefix="new-eq"
              value={creating}
              onChange={setCreating}
              sectors={sectors}
              suggestions={suggestions}
              onCreateSector={onCreateSector}
              allowAutoNow
            />
            {errorBox}
            <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <button type="button" className="tw-btn" onClick={() => setCreating(null)}>Cancelar</button>
              <button type="submit" className="tw-btn tw-btn-primary" disabled={saving}>{saving ? "Salvando..." : "Cadastrar"}</button>
            </div>
          </form>
        )}
      </dialog>

      {/* Editar */}
      <dialog ref={editRef} aria-labelledby="edit-eq-title" className="m-auto w-[min(96vw,660px)] max-h-[92vh] rounded-xl p-0 overflow-auto shadow-xl">
        {editing && (
          <form onSubmit={submitEdit} className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
              <h2 id="edit-eq-title" className="text-base font-semibold">Editar {editing.item.name}</h2>
              <button type="button" aria-label="Fechar" className="tw-btn tw-btn-sm" onClick={() => setEditing(null)}><X className="w-4 h-4" /></button>
            </div>
            <EquipmentFormFields
              idPrefix="edit-eq"
              value={editing.fields}
              onChange={(fields) => setEditing({ ...editing, fields })}
              sectors={sectors}
              suggestions={suggestions}
              onCreateSector={onCreateSector}
              allowAutoNow={false}
              lockedCondition={
                openByEquipment.has(editing.item.id)
                  ? `Está fora em ${openByEquipment.get(editing.item.id)!.document_code}. Registre a devolução para mudar a situação.`
                  : undefined
              }
            />
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={editing.active} disabled={openByEquipment.has(editing.item.id)} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              <span>Ativo no acervo</span>
            </label>
            {errorBox}
            <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <button type="button" className="tw-btn" onClick={() => setEditing(null)}>Cancelar</button>
              <button type="submit" className="tw-btn tw-btn-primary" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
            </div>
          </form>
        )}
      </dialog>

      {/* Detalhes */}
      <dialog ref={detailsRef} aria-labelledby="eq-details-title" className="m-auto w-[min(96vw,720px)] max-h-[92vh] rounded-xl p-0 overflow-auto shadow-xl">
        {details && (
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--border)" }}>
              <div>
                <h2 id="eq-details-title" className="text-base font-semibold">{details.name}</h2>
                <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{details.patrimony || "Sem patrimônio"}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {(details.ownership_type === "terceiro" || details.condition_status === "devolvido_dono") && (
                  <button type="button" className="tw-btn tw-btn-sm" onClick={() => onPrintReceipt(details)}>
                    <Printer className="w-3.5 h-3.5" aria-hidden="true" /> Comprovante PDF
                  </button>
                )}
                <button type="button" aria-label="Fechar" className="tw-btn tw-btn-sm" onClick={() => setDetails(null)}><X className="w-4 h-4" /></button>
              </div>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Situação</dt><dd><span className="tw-badge" style={conditionStyle(details.condition_status)}>{CONDITION_LABELS[details.condition_status]}</span></dd></div>
              <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Onde está</dt><dd>{whereIs(details)}</dd></div>
              <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Posse</dt><dd>{OWNERSHIP_LABELS[details.ownership_type]}</dd></div>
              <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Categoria</dt><dd>{details.category || "-"}</dd></div>
              {(details.ownership_type === "terceiro" || details.origin || details.received_from) && (
                <>
                  <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Setor / origem</dt><dd>{details.origin || "-"}</dd></div>
                  <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Entregue à TI por</dt><dd>{details.received_from || "-"}</dd></div>
                  <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Recebido pela TI em</dt><dd>{formatDateTime(details.received_at || details.created_at)}</dd></div>
                </>
              )}
              {details.condition_status === "devolvido_dono" && (
                <div className="sm:col-span-2">
                  <dt className="text-xs" style={{ color: "var(--text-muted)" }}>Devolução ao dono</dt>
                  <dd>{formatDateTime(details.owner_returned_at)} · recebido por {details.owner_received_by || "-"} · registrado por {details.owner_returned_by_name || "-"}</dd>
                </div>
              )}
              <div className="sm:col-span-2"><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Motivo</dt><dd>{details.reason || "-"}</dd></div>
              {details.notes && <div className="sm:col-span-2"><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Observações</dt><dd className="whitespace-pre-line">{details.notes}</dd></div>}
              <div className="sm:col-span-2 text-xs" style={{ color: "var(--text-muted)" }}>
                Cadastrado por {details.created_by_name || "-"} em {formatDateTime(details.created_at)} · última alteração por {details.updated_by_name || "-"} em {formatDateTime(details.updated_at)}
              </div>
            </dl>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Histórico de movimentações ({detailMovements.length})</h3>
              {detailMovements.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>Este equipamento ainda não saiu do TI.</p>
              ) : (
                <ul className="space-y-1.5">
                  {detailMovements.map((m) => (
                    <li key={m.client_uuid} className="tw-card px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2" style={{ backgroundColor: "var(--bg)" }}>
                      <span>
                        <span className="font-mono text-xs mr-2" style={{ color: "var(--text-muted)" }}>{m.document_code}</span>
                        {m.sector_name} — {m.install_location}
                        <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                          Saída {formatDateTime(m.out_at)}{m.returned_at ? ` · volta ${formatDateTime(m.returned_at)}` : ""}
                        </span>
                      </span>
                      <span className="tw-badge" style={movementStatusStyle(m)}>{movementStatusLabel(m)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </dialog>

      {/* Devolver ao dono */}
      <dialog ref={returnRef} aria-labelledby="owner-return-title" className="m-auto w-[min(94vw,480px)] rounded-xl p-5 shadow-xl">
        {returning && (
          <form onSubmit={submitReturnToOwner} className="space-y-4">
            <h2 id="owner-return-title" className="text-base font-semibold">Devolver {returning.item.name} ao dono</h2>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              O equipamento fica marcado como <strong>Devolvido ao dono</strong>, mantém todo o histórico de recebimento e entrega e libera emissão de comprovante PDF.
            </p>
            <div>
              <label htmlFor="owner-received" className="tw-label">Quem recebeu de volta <span aria-hidden="true">*</span></label>
              <input id="owner-received" required value={returning.receivedBy} onChange={(e) => setReturning({ ...returning, receivedBy: e.target.value })} className="tw-input" />
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <span className="tw-label mb-0">Data/hora da entrega de volta</span>
                <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={returning.autoNow}
                    onChange={(e) => setReturning({ ...returning, autoNow: e.target.checked })}
                  />
                  <span>Agora</span>
                </label>
              </div>
              {!returning.autoNow && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    aria-label="Data da devolução ao dono"
                    value={returning.returnedDate}
                    onChange={(e) => setReturning({ ...returning, returnedDate: e.target.value })}
                    className="tw-input"
                    required
                  />
                  <input
                    type="time"
                    aria-label="Hora da devolução ao dono"
                    value={returning.returnedTime}
                    onChange={(e) => setReturning({ ...returning, returnedTime: e.target.value })}
                    className="tw-input"
                    required
                  />
                </div>
              )}
            </div>
            <div>
              <label htmlFor="owner-notes" className="tw-label">Observações</label>
              <textarea id="owner-notes" value={returning.notes} onChange={(e) => setReturning({ ...returning, notes: e.target.value })} placeholder="Ex.: consertado, trocada a bateria" className="tw-textarea" />
            </div>
            {errorBox}
            <div className="flex justify-end gap-2">
              <button type="button" className="tw-btn" onClick={() => setReturning(null)}>Cancelar</button>
              <button type="submit" className="tw-btn tw-btn-primary" disabled={saving}>{saving ? "Salvando..." : "Confirmar devolução"}</button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
