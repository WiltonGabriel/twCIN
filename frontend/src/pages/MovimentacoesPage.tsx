import { Check, Clock, History, Pencil, Plus, Printer, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { EquipmentPicker, type EquipmentSelection } from "../components/EquipmentPicker";
import { OnlineOnlyNotice } from "../components/OnlineOnlyNotice";
import { PageIntro } from "../components/PageIntro";
import { findCatalogSector, SectorSelector } from "../components/SectorSelector";
import { apiRequest } from "../services/api";
import type {
  AuditLogItem,
  CatalogEquipment,
  CatalogLocation,
  CatalogSector,
  MovementItem,
  MovementType,
  SuggestionsPayload
} from "../types";
import {
  daysOverdue,
  formatDate,
  formatDateTime,
  isOverdue,
  movementStatusLabel,
  movementStatusStyle
} from "../types/labels";
import {
  addDays,
  dueDateToIso,
  isoToLocalDate,
  isoToLocalTime,
  localDate,
  localTime,
  toIso
} from "../utils/dateInput";
import { collectSectorFilterOptions, matchMovementSector } from "../utils/sectorFilters";

type MovementPayload = {
  movement_type: MovementType;
  equipment_id: number | null;
  equipment_name: string;
  patrimony: string;
  sector_id: number | null;
  sector_name: string;
  install_location: string;
  received_by: string;
  notes: string;
  out_at?: string;
  due_at?: string | null;
};

interface MovimentacoesPageProps {
  items: MovementItem[];
  equipments: CatalogEquipment[];
  sectors: CatalogSector[];
  locations: CatalogLocation[];
  suggestions: SuggestionsPayload;
  online: boolean;
  loanDefaultDays: number;
  onCreate: (payload: MovementPayload) => Promise<void>;
  onUpdate: (item: MovementItem, patch: Partial<MovementPayload>) => Promise<void>;
  onReturn: (item: MovementItem) => Promise<void>;
  onCreateSector: (payload: { name: string; is_default?: boolean }) => Promise<CatalogSector>;
  onPrintSingle: (item: MovementItem) => void;
  onPrintList: (items: MovementItem[], title?: string) => void;
  onOpenAudit: (item: MovementItem) => void;
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

// ---------- formulário compartilhado (nova movimentação e edição) ----------
interface FormState {
  autoNow: boolean;
  outDate: string;
  outTime: string;
  equipment: EquipmentSelection;
  sectorName: string;
  installLocation: string;
  receivedBy: string;
  movementType: MovementType;
  hasDue: boolean;
  dueDate: string;
  notes: string;
}

function emptyForm(defaultSector: string, loanDays: number): FormState {
  const now = new Date();
  return {
    autoNow: true,
    outDate: localDate(now),
    outTime: localTime(now),
    equipment: { equipment_id: null, equipment_name: "", patrimony: "" },
    sectorName: defaultSector,
    installLocation: "",
    receivedBy: "",
    movementType: "emprestimo",
    hasDue: loanDays > 0,
    dueDate: loanDays > 0 ? addDays(loanDays) : "",
    notes: ""
  };
}

function formFromMovement(m: MovementItem): FormState {
  return {
    autoNow: false,
    outDate: isoToLocalDate(m.out_at),
    outTime: isoToLocalTime(m.out_at),
    equipment: { equipment_id: m.equipment_id, equipment_name: m.equipment_name, patrimony: m.patrimony },
    sectorName: m.sector_name,
    installLocation: m.install_location,
    receivedBy: m.received_by,
    movementType: m.movement_type,
    hasDue: Boolean(m.due_at),
    dueDate: isoToLocalDate(m.due_at),
    notes: m.notes
  };
}

interface MovementFormFieldsProps {
  idPrefix: string;
  form: FormState;
  setForm: (f: FormState) => void;
  equipments: CatalogEquipment[];
  movements: MovementItem[];
  sectors: CatalogSector[];
  locations: CatalogLocation[];
  suggestions: SuggestionsPayload;
  loanDefaultDays: number;
  onCreateSector: MovimentacoesPageProps["onCreateSector"];
  editingMovementId?: number;
  allowAutoNow: boolean;
}

function MovementFormFields({
  idPrefix,
  form,
  setForm,
  equipments,
  movements,
  sectors,
  locations,
  suggestions,
  loanDefaultDays,
  onCreateSector,
  editingMovementId,
  allowAutoNow
}: MovementFormFieldsProps) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm({ ...form, [key]: value });
  const handleTypeChange = (type: MovementType) => {
    if (type === "emprestimo" && !form.dueDate && loanDefaultDays > 0) {
      setForm({ ...form, movementType: type, hasDue: true, dueDate: addDays(loanDefaultDays) });
      return;
    }
    set("movementType", type);
  };
  const matchedSector = findCatalogSector(sectors, form.sectorName);
  const sectorLocations = matchedSector
    ? locations.filter((l) => l.active === 1 && l.sector_id === matchedSector.id)
    : [];
  const locationOptions = Array.from(
    new Set([
      ...sectorLocations.map((l) => l.name),
      ...locations.filter((l) => l.active === 1 && l.sector_id === null).map((l) => l.name),
      ...suggestions.locations
    ])
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <fieldset className="sm:col-span-2">
        <legend className="tw-label">Tipo de saída</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(["emprestimo", "instalacao_fixa"] as const).map((type) => (
            <label key={type} className="inline-flex items-center gap-2 cursor-pointer">
              <input type="radio" name={`${idPrefix}-type`} checked={form.movementType === type} onChange={() => handleTypeChange(type)} />
              <span>{type === "emprestimo" ? "Empréstimo" : "Instalação fixa"}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-equip`} className="tw-label">
          Equipamento <span aria-hidden="true">*</span>
        </label>
        <EquipmentPicker
          id={`${idPrefix}-equip`}
          equipments={equipments}
          movements={movements}
          value={form.equipment}
          onChange={(equipment) => set("equipment", equipment)}
          editingMovementId={editingMovementId}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-sector`} className="tw-label">
          Setor de destino <span aria-hidden="true">*</span>
        </label>
        <SectorSelector
          id={`${idPrefix}-sector`}
          required
          value={form.sectorName}
          onChange={(name) => set("sectorName", name)}
          sectors={sectors}
          suggestedNames={suggestions.sectors.map((s) => s.name)}
          onCreateSector={onCreateSector}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-local`} className="tw-label">
          Local de instalação <span aria-hidden="true">*</span>
        </label>
        <input id={`${idPrefix}-local`} list={`${idPrefix}-local-list`} required value={form.installLocation} onChange={(e) => set("installLocation", e.target.value)} placeholder="Sala ou ambiente" className="tw-input" />
        <datalist id={`${idPrefix}-local-list`}>
          {locationOptions.map((loc) => <option key={loc} value={loc} />)}
        </datalist>
        {sectorLocations.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-xs">
            <span style={{ color: "var(--text-muted)" }}>Do setor:</span>
            {sectorLocations.slice(0, 6).map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => set("installLocation", loc.name)}
                className="px-2 py-0.5 rounded-full border cursor-pointer"
                style={
                  form.installLocation.trim().toLowerCase() === loc.name.toLowerCase()
                    ? { backgroundColor: "var(--brand-soft)", borderColor: "var(--brand)", color: "var(--brand)" }
                    : { backgroundColor: "var(--bg)", borderColor: "var(--border)" }
                }
              >
                {loc.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label htmlFor={`${idPrefix}-receiver`} className="tw-label">Recebido por</label>
        <input id={`${idPrefix}-receiver`} list={`${idPrefix}-people`} value={form.receivedBy} onChange={(e) => set("receivedBy", e.target.value)} placeholder="Nome de quem recebeu" className="tw-input" />
        <datalist id={`${idPrefix}-people`}>
          {suggestions.people.map((p) => <option key={p} value={p} />)}
        </datalist>
      </div>

      <div>
        {form.movementType === "emprestimo" ? (
          <>
            <label htmlFor={`${idPrefix}-due`} className="tw-label">Prazo de devolução</label>
            <input
              id={`${idPrefix}-due`}
              type="date"
              value={form.hasDue ? form.dueDate : ""}
              disabled={!form.hasDue}
              min={form.autoNow ? localDate() : form.outDate}
              required={form.hasDue}
              onChange={(e) => set("dueDate", e.target.value)}
              className="tw-input"
            />
            <label className="mt-1 inline-flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={!form.hasDue}
                onChange={(e) =>
                  setForm({
                    ...form,
                    hasDue: !e.target.checked,
                    dueDate: form.dueDate || addDays(loanDefaultDays > 0 ? loanDefaultDays : 7)
                  })
                }
              />
              <span>Sem prazo</span>
            </label>
          </>
        ) : (
          <p className="text-xs pt-6" style={{ color: "var(--text-muted)" }}>Instalação fixa não tem prazo de devolução.</p>
        )}
      </div>

      <div className="sm:col-span-2 p-3 rounded-lg border space-y-2" style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}>
        {allowAutoNow && (
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
            <input type="checkbox" checked={form.autoNow} onChange={(e) => set("autoNow", e.target.checked)} />
            <span>Registrar com a data e hora atuais</span>
          </label>
        )}
        {allowAutoNow && form.autoNow ? (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            <span>A hora será definida pelo servidor no momento do registro.</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${idPrefix}-date`} className="tw-label">Data da saída</label>
              <input id={`${idPrefix}-date`} type="date" required value={form.outDate} onChange={(e) => set("outDate", e.target.value)} className="tw-input" />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-time`} className="tw-label">Hora</label>
              <input id={`${idPrefix}-time`} type="time" required value={form.outTime} onChange={(e) => set("outTime", e.target.value)} className="tw-input" />
            </div>
          </div>
        )}
      </div>

      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-notes`} className="tw-label">Observações</label>
        <textarea id={`${idPrefix}-notes`} value={form.notes} onChange={(e) => set("notes", e.target.value)} className="tw-textarea" />
      </div>
    </div>
  );
}

// ---------- página ----------
type OpenFilter = "todos" | "emprestimos" | "atrasados" | "instalacoes";

export function MovimentacoesPage({
  items,
  equipments,
  sectors,
  locations,
  suggestions,
  online,
  loanDefaultDays,
  onCreate,
  onUpdate,
  onReturn,
  onCreateSector,
  onPrintSingle,
  onPrintList,
  onOpenAudit
}: MovimentacoesPageProps) {
  const defaultSector =
    sectors.find((s) => s.active === 1 && s.is_default === 1)?.name ||
    suggestions.sectors.find((s) => s.is_default)?.name ||
    "";

  const [tab, setTab] = useState<"abertos" | "historico" | "logs">("abertos");
  const [openFilter, setOpenFilter] = useState<OpenFilter>("todos");
  const [openSector, setOpenSector] = useState("all");
  const [search, setSearch] = useState("");
  const [histStatus, setHistStatus] = useState<"all" | "ativo" | "devolvido" | "fixo">("all");
  const [histSector, setHistSector] = useState("all");

  const [creating, setCreating] = useState<FormState | null>(null);
  const [editing, setEditing] = useState<{ item: MovementItem; form: FormState } | null>(null);
  const [returning, setReturning] = useState<MovementItem | null>(null);
  const [pendingSector, setPendingSector] = useState<{ mode: "create" | "edit"; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [logsCursor, setLogsCursor] = useState<number | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  const createRef = useDialog(Boolean(creating), () => setCreating(null));
  const editRef = useDialog(Boolean(editing), () => setEditing(null));
  const returnRef = useDialog(Boolean(returning), () => setReturning(null));
  const sectorRef = useDialog(Boolean(pendingSector), () => setPendingSector(null));

  const openItems = items.filter((m) => m.status === "ativo" || m.status === "fixo");
  const loans = openItems.filter((m) => m.status === "ativo");
  const overdue = loans.filter((m) => isOverdue(m));
  const installs = openItems.filter((m) => m.status === "fixo");

  const matches = (m: MovementItem, q: string) =>
    !q ||
    [m.document_code, m.equipment_name, m.patrimony, m.sector_name, m.install_location, m.received_by, m.registered_by_name, m.notes]
      .join(" ")
      .toLowerCase()
      .includes(q);

  const sectorOptions = useMemo(
    () => collectSectorFilterOptions(sectors, equipments, items),
    [sectors, equipments, items]
  );

  const q = search.trim().toLowerCase();
  const openSectorOpt = openSector === "all" ? null : sectorOptions.find((s) => s.name === openSector) ?? { id: null, name: openSector };
  const filteredOpen = (openFilter === "emprestimos" ? loans : openFilter === "atrasados" ? overdue : openFilter === "instalacoes" ? installs : openItems)
    .filter((m) => (!openSectorOpt ? true : matchMovementSector(m, openSectorOpt)))
    .filter((m) => matches(m, q))
    .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || b.out_at.localeCompare(a.out_at));

  const histSectorOpt = histSector === "all" ? null : sectorOptions.find((s) => s.name === histSector) ?? { id: null, name: histSector };
  const filteredHistory = items.filter((m) => {
    if (histStatus !== "all" && m.status !== histStatus) return false;
    if (histSectorOpt && !matchMovementSector(m, histSectorOpt)) return false;
    return matches(m, q);
  });

  // ---------- logs paginados ----------
  const loadLogs = async (reset: boolean) => {
    setLoadingLogs(true);
    setLogsError(null);
    try {
      const cursor = reset ? null : logsCursor;
      const res = await apiRequest<{ items: AuditLogItem[]; next_before_id: number | null }>(
        `/api/audit?entity=movement&limit=100${cursor ? `&before_id=${cursor}` : ""}`
      );
      setLogs((prev) => (reset ? res.items : [...prev, ...res.items]));
      setLogsCursor(res.next_before_id);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : "Não foi possível carregar os registros (é preciso estar online).");
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (tab === "logs") void loadLogs(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ---------- salvar ----------
  const buildPayload = (form: FormState, sector: { id: number | null; name: string }, isEdit: boolean): MovementPayload | string => {
    if (!form.equipment.equipment_name.trim()) return "Escolha o equipamento.";
    const payload: MovementPayload = {
      movement_type: form.movementType,
      equipment_id: form.equipment.equipment_id,
      equipment_name: form.equipment.equipment_name,
      patrimony: form.equipment.patrimony,
      sector_id: sector.id && sector.id > 0 ? sector.id : null,
      sector_name: sector.name,
      install_location: form.installLocation.trim(),
      received_by: form.receivedBy,
      notes: form.notes
    };
    if (!form.autoNow || isEdit) {
      const outAt = toIso(form.outDate, form.outTime);
      if (!outAt) return "Data ou hora de saída inválida.";
      payload.out_at = outAt;
    }
    if (form.movementType === "emprestimo") {
      payload.due_at = form.hasDue ? dueDateToIso(form.dueDate) : null;
      if (form.hasDue && !payload.due_at) return "Informe o prazo de devolução ou marque \"Sem prazo\".";
    }
    return payload;
  };

  const resolveSector = (name: string) => {
    const trimmed = name.trim();
    const match = findCatalogSector(sectors, trimmed);
    return match ? { id: match.id, name: match.name } : trimmed ? null : { id: null, name: trimmed };
  };

  const submitCreate = async (sector: { id: number | null; name: string }) => {
    if (!creating) return;
    const payload = buildPayload(creating, sector, false);
    if (typeof payload === "string") return setError(payload);
    setSaving(true);
    setError(null);
    try {
      await onCreate(payload);
      setCreating(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registrar movimentação.");
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async (sector: { id: number | null; name: string }) => {
    if (!editing) return;
    const payload = buildPayload(editing.form, sector, true);
    if (typeof payload === "string") return setError(payload);
    setSaving(true);
    setError(null);
    try {
      await onUpdate(editing.item, payload);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar alterações.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!creating) return;
    const sector = resolveSector(creating.sectorName);
    if (!sector) return setPendingSector({ mode: "create", name: creating.sectorName.trim() });
    void submitCreate(sector);
  };

  const handleEditSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const sector = resolveSector(editing.form.sectorName);
    if (!sector) return setPendingSector({ mode: "edit", name: editing.form.sectorName.trim() });
    void submitEdit(sector);
  };

  const confirmNewSector = async () => {
    if (!pendingSector) return;
    const { mode, name } = pendingSector;
    setPendingSector(null);
    try {
      const created = await onCreateSector({ name });
      const sector = { id: created.id, name: created.name };
      if (mode === "create") await submitCreate(sector);
      else await submitEdit(sector);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar setor.");
    }
  };

  const confirmReturn = async () => {
    if (!returning) return;
    setSaving(true);
    setError(null);
    try {
      await onReturn(returning);
      setReturning(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registrar devolução.");
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setError(null);
    setCreating(emptyForm(defaultSector, loanDefaultDays));
  };

  const openEdit = (m: MovementItem) => {
    setError(null);
    setEditing({ item: m, form: formFromMovement(m) });
  };

  const tabButton = (key: typeof tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className="px-3.5 py-2 rounded-lg text-sm font-medium cursor-pointer"
      style={tab === key ? { backgroundColor: "var(--brand)", color: "var(--brand-fg)" } : { color: "var(--text-muted)" }}
    >
      {label}
    </button>
  );

  const rowActions = (m: MovementItem) => (
    <div className="flex flex-wrap justify-end gap-1.5">
      <button type="button" className="tw-btn tw-btn-sm" onClick={() => onPrintSingle(m)} aria-label={`PDF de ${m.document_code}`}>
        <Printer className="w-3.5 h-3.5" aria-hidden="true" /> PDF
      </button>
      <button type="button" className="tw-btn tw-btn-sm" onClick={() => openEdit(m)}>
        <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Editar
      </button>
      {m.id > 0 && (
        <button type="button" className="tw-btn tw-btn-sm" onClick={() => onOpenAudit(m)}>
          <History className="w-3.5 h-3.5" aria-hidden="true" /> Logs
        </button>
      )}
      {m.status === "ativo" && (
        <button type="button" className="tw-btn tw-btn-sm tw-btn-ok" onClick={() => setReturning(m)}>
          <Check className="w-3.5 h-3.5" aria-hidden="true" /> Registrar devolução
        </button>
      )}
      {m.status === "fixo" && (
        <button type="button" className="tw-btn tw-btn-sm" onClick={() => setReturning(m)}>
          <Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> Desfazer instalação
        </button>
      )}
    </div>
  );

  const errorBox = error && (
    <div role="alert" className="px-3 py-2 rounded-lg text-sm border" style={{ backgroundColor: "var(--cin-red-soft)", borderColor: "var(--cin-red)", color: "var(--cin-red)" }}>
      {error}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageIntro
        title="Movimentações"
        purpose="Registra empréstimos e instalações fixas para outros setores, acompanha prazos e devoluções e mantém o histórico completo."
        howTo={[
          "Use \"Nova movimentação\", escolha o equipamento do catálogo e o setor de destino.",
          "Em \"Em aberto\", acompanhe o que está fora e os atrasados, e registre a devolução.",
          "Em \"Histórico\" e \"Registros\", consulte movimentações anteriores, a trilha de auditoria e exporte PDF."
        ]}
        actions={
          <button type="button" className="tw-btn tw-btn-primary" onClick={openCreate}>
            <Plus className="w-4 h-4" aria-hidden="true" /> Nova movimentação
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button type="button" className="tw-stat text-left cursor-pointer" onClick={() => { setTab("abertos"); setOpenFilter("emprestimos"); }}>
          <span className="tw-stat-label">Emprestados</span>
          <strong style={{ color: "var(--brand)" }}>{loans.length}</strong>
        </button>
        <button type="button" className="tw-stat text-left cursor-pointer" onClick={() => { setTab("abertos"); setOpenFilter("atrasados"); }}>
          <span className="tw-stat-label">Atrasados</span>
          <strong style={{ color: overdue.length ? "var(--cin-red)" : undefined }}>{overdue.length}</strong>
        </button>
        <button type="button" className="tw-stat text-left cursor-pointer" onClick={() => { setTab("abertos"); setOpenFilter("instalacoes"); }}>
          <span className="tw-stat-label">Instalações fixas</span>
          <strong>{installs.length}</strong>
        </button>
        <div className="tw-stat">
          <span className="tw-stat-label">Devolvidos</span>
          <strong style={{ color: "var(--ok)" }}>{items.filter((m) => m.status === "devolvido").length}</strong>
        </div>
      </div>

      <section className="tw-card p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div role="tablist" aria-label="Visões de movimentações" className="flex flex-wrap gap-1">
            {tabButton("abertos", `Em aberto (${openItems.length})`)}
            {tabButton("historico", "Histórico")}
            {tabButton("logs", "Registros")}
          </div>
          {tab !== "logs" && (
            <div className="flex flex-wrap items-center gap-2">
              <input type="search" aria-label="Buscar movimentações" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar código, equipamento, setor..." className="tw-input sm:w-64" />
              <button
                type="button"
                className="tw-btn"
                onClick={() =>
                  tab === "abertos"
                    ? onPrintList(
                        filteredOpen,
                        openSectorOpt ? `Em aberto — ${openSectorOpt.name}` : "Movimentações em aberto"
                      )
                    : onPrintList(
                        filteredHistory,
                        histSectorOpt ? `Histórico — ${histSectorOpt.name}` : "Histórico de movimentações"
                      )
                }
              >
                <Printer className="w-4 h-4" aria-hidden="true" /> PDF
              </button>
            </div>
          )}
        </div>

        {tab === "abertos" && (
          <>
            <search className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar em aberto">
                {(
                  [
                    ["todos", `Todos (${openItems.length})`],
                    ["emprestimos", `Empréstimos (${loans.length})`],
                    ["atrasados", `Atrasados (${overdue.length})`],
                    ["instalacoes", `Instalações fixas (${installs.length})`]
                  ] as Array<[OpenFilter, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={openFilter === key}
                    onClick={() => setOpenFilter(key)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer"
                    style={openFilter === key ? { backgroundColor: "var(--brand-soft)", borderColor: "var(--brand)", color: "var(--brand)" } : { borderColor: "var(--border)", color: "var(--text-muted)" }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                aria-label="Filtrar setor em aberto"
                value={openSector}
                onChange={(e) => setOpenSector(e.target.value)}
                className="tw-input sm:w-56"
              >
                <option value="all">Todos os setores</option>
                {sectorOptions.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </search>

            {filteredOpen.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>
                {openItems.length === 0 ? "Nenhum equipamento fora no momento." : "Nada encontrado com esses filtros."}
              </p>
            ) : (
              <div className="table-wrapper" role="region" aria-label="Movimentações em aberto" tabIndex={0}>
                <table className="tw-table responsive-table">
                  <thead>
                    <tr>
                      <th scope="col">Equipamento</th>
                      <th scope="col">Setor / local</th>
                      <th scope="col">Recebido por</th>
                      <th scope="col">Saída</th>
                      <th scope="col">Prazo</th>
                      <th scope="col"><span className="sr-only">Ações</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOpen.map((m) => (
                      <tr key={m.client_uuid}>
                        <td data-label="Equipamento">
                          <div className="font-semibold">{m.equipment_name}</div>
                          <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                            {m.document_code}
                            {m.patrimony ? ` · ${m.patrimony}` : ""}
                            {m._pendingSync && <span style={{ color: "var(--warn)" }}> · aguardando envio</span>}
                          </div>
                        </td>
                        <td data-label="Setor / local">
                          {m.sector_name}
                          <div className="text-xs" style={{ color: "var(--text-muted)" }}>{m.install_location}</div>
                        </td>
                        <td data-label="Recebido por">{m.received_by || "-"}</td>
                        <td data-label="Saída">
                          {formatDateTime(m.out_at)}
                          <div className="text-xs" style={{ color: "var(--text-muted)" }}>por {m.registered_by_name}</div>
                        </td>
                        <td data-label="Prazo">
                          {m.status === "fixo" ? (
                            <span className="tw-badge" style={movementStatusStyle(m)}>Instalação fixa</span>
                          ) : m.due_at ? (
                            <span className="tw-badge" style={movementStatusStyle(m)}>
                              {isOverdue(m) ? `Atrasado ${daysOverdue(m) || ""}${daysOverdue(m) ? "d" : ""}`.trim() : `Até ${formatDate(m.due_at)}`}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Sem prazo</span>
                          )}
                        </td>
                        <td>{rowActions(m)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === "historico" && (
          <>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Filtrar situação" value={histStatus} onChange={(e) => setHistStatus(e.target.value as typeof histStatus)} className="tw-input sm:w-44">
                <option value="all">Todas as situações</option>
                <option value="ativo">Emprestado</option>
                <option value="devolvido">Devolvido</option>
                <option value="fixo">Instalação fixa</option>
              </select>
              <select aria-label="Filtrar setor" value={histSector} onChange={(e) => setHistSector(e.target.value)} className="tw-input sm:w-52">
                <option value="all">Todos os setores</option>
                {sectorOptions.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div className="table-wrapper" role="region" aria-label="Histórico de movimentações" tabIndex={0}>
              <table className="tw-table responsive-table">
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Equipamento</th>
                    <th scope="col">Setor / local</th>
                    <th scope="col">Saída</th>
                    <th scope="col">Situação</th>
                    <th scope="col"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((m) => (
                    <tr key={m.client_uuid}>
                      <td data-label="Código" className="font-mono text-xs">{m.document_code}</td>
                      <td data-label="Equipamento">
                        <strong>{m.equipment_name}</strong>
                        {m.patrimony && <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{m.patrimony}</div>}
                      </td>
                      <td data-label="Setor / local">
                        {m.sector_name}
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{m.install_location}</div>
                      </td>
                      <td data-label="Saída">
                        {formatDateTime(m.out_at)}
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>por {m.registered_by_name}</div>
                      </td>
                      <td data-label="Situação">
                        <span className="tw-badge" style={movementStatusStyle(m)}>{movementStatusLabel(m)}</span>
                        {m.status === "devolvido" && (
                          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {formatDateTime(m.returned_at)} · {m.returned_to_name || "-"}
                          </div>
                        )}
                      </td>
                      <td>{rowActions(m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredHistory.length === 0 && (
                <p className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>Nenhuma movimentação encontrada.</p>
              )}
            </div>
          </>
        )}

        {tab === "logs" && (
          <div className="space-y-2">
            {!online && <OnlineOnlyNotice text="Você está offline. Os registros completos de movimentações exigem conexão." />}
            {logsError && <p className="text-sm" style={{ color: "var(--warn)" }}>{logsError}</p>}
            {!loadingLogs && !logsError && logs.length === 0 && (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>Nenhum registro de movimentação.</p>
            )}
            <ul className="space-y-2">
              {logs.map((log) => (
                <li key={log.id} className="tw-card p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2" style={{ backgroundColor: "var(--bg)" }}>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="tw-badge" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand)" }}>{log.action}</span>
                      <strong>{log.user_name}</strong>
                    </div>
                    <p className="text-sm">{log.summary}</p>
                  </div>
                  <span className="shrink-0" style={{ color: "var(--text-muted)" }}>{formatDateTime(log.created_at)}</span>
                </li>
              ))}
            </ul>
            {logsCursor && (
              <button type="button" className="tw-btn" disabled={loadingLogs} onClick={() => void loadLogs(false)}>
                {loadingLogs ? "Carregando..." : "Carregar mais"}
              </button>
            )}
            {loadingLogs && logs.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Carregando...</p>}
          </div>
        )}
      </section>

      {/* Nova movimentação */}
      <dialog ref={createRef} aria-labelledby="new-mov-title" className="m-auto w-[min(96vw,680px)] max-h-[92vh] rounded-xl p-0 overflow-auto shadow-xl">
        {creating && (
          <form onSubmit={handleCreateSubmit} className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
              <h2 id="new-mov-title" className="text-base font-semibold">Nova movimentação</h2>
              <button type="button" aria-label="Fechar" className="tw-btn tw-btn-sm" onClick={() => setCreating(null)}><X className="w-4 h-4" /></button>
            </div>
            <MovementFormFields
              idPrefix="new-mov"
              form={creating}
              setForm={setCreating}
              equipments={equipments}
              movements={items}
              sectors={sectors}
              locations={locations}
              suggestions={suggestions}
              loanDefaultDays={loanDefaultDays}
              onCreateSector={onCreateSector}
              allowAutoNow
            />
            {errorBox}
            <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <button type="button" className="tw-btn" onClick={() => setCreating(null)}>Cancelar</button>
              <button type="submit" className="tw-btn tw-btn-primary" disabled={saving}>{saving ? "Salvando..." : "Registrar saída"}</button>
            </div>
          </form>
        )}
      </dialog>

      {/* Edição */}
      <dialog ref={editRef} aria-labelledby="edit-mov-title" className="m-auto w-[min(96vw,680px)] max-h-[92vh] rounded-xl p-0 overflow-auto shadow-xl">
        {editing && (
          <form onSubmit={handleEditSubmit} className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
              <h2 id="edit-mov-title" className="text-base font-semibold">Editar {editing.item.document_code}</h2>
              <button type="button" aria-label="Fechar" className="tw-btn tw-btn-sm" onClick={() => setEditing(null)}><X className="w-4 h-4" /></button>
            </div>
            <MovementFormFields
              idPrefix="edit-mov"
              form={editing.form}
              setForm={(form) => setEditing({ ...editing, form })}
              equipments={equipments}
              movements={items}
              sectors={sectors}
              locations={locations}
              suggestions={suggestions}
              loanDefaultDays={loanDefaultDays}
              onCreateSector={onCreateSector}
              editingMovementId={editing.item.id}
              allowAutoNow={false}
            />
            {errorBox}
            <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <button type="button" className="tw-btn" onClick={() => setEditing(null)}>Cancelar</button>
              <button type="submit" className="tw-btn tw-btn-primary" disabled={saving}>{saving ? "Salvando..." : "Salvar alterações"}</button>
            </div>
          </form>
        )}
      </dialog>

      {/* Confirmação de devolução / desfazer instalação */}
      <dialog ref={returnRef} aria-labelledby="return-title" className="m-auto w-[min(94vw,440px)] rounded-xl p-5 shadow-xl">
        {returning && (
          <div className="space-y-4">
            <h2 id="return-title" className="text-base font-semibold">
              {returning.status === "fixo" ? "Desfazer instalação?" : "Registrar devolução?"}
            </h2>
            <p className="text-sm">
              <strong>{returning.equipment_name}</strong> ({returning.document_code}) volta do setor{" "}
              <strong>{returning.sector_name}</strong> e fica disponível no estoque do TI. A data e a hora serão as de agora.
            </p>
            {errorBox}
            <div className="flex justify-end gap-2">
              <button type="button" className="tw-btn" onClick={() => setReturning(null)}>Cancelar</button>
              <button type="button" className="tw-btn tw-btn-ok" disabled={saving} onClick={() => void confirmReturn()}>
                {saving ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        )}
      </dialog>

      {/* Confirmação de setor novo */}
      <dialog ref={sectorRef} aria-labelledby="new-sector-title" className="m-auto w-[min(94vw,430px)] rounded-xl p-5 shadow-xl">
        {pendingSector && (
          <div className="space-y-4">
            <h2 id="new-sector-title" className="text-base font-semibold">Cadastrar setor novo?</h2>
            <p className="text-sm">
              O setor <strong>{pendingSector.name}</strong> não existe no catálogo. Deseja cadastrá-lo e continuar?
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="tw-btn" onClick={() => setPendingSector(null)}>Cancelar</button>
              <button type="button" className="tw-btn tw-btn-primary" onClick={() => void confirmNewSector()}>Cadastrar e continuar</button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
