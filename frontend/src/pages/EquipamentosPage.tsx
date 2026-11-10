import { Eye, History, Pencil, Plus, Printer, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PageIntro } from "../components/PageIntro";
import { apiRequest } from "../services/api";
import type { CatalogEquipment, EquipmentCondition, EquipmentOwnership, MovementItem } from "../types";
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

type EquipmentFields = {
  name: string;
  patrimony: string;
  category: string;
  ownership_type: EquipmentOwnership;
  condition_status: EquipmentCondition;
  origin: string;
  received_from: string;
  reason: string;
  notes: string;
};

interface EquipamentosPageProps {
  equipments: CatalogEquipment[];
  movements: MovementItem[];
  onCreate: (payload: EquipmentFields) => Promise<void>;
  onUpdate: (item: CatalogEquipment, patch: Partial<EquipmentFields & { active: boolean }>) => Promise<void>;
  onReturnToOwner: (item: CatalogEquipment, input: { received_by: string; notes?: string }) => Promise<void>;
  onOpenAudit: (item: CatalogEquipment) => void;
  onPrintReport: (items: CatalogEquipment[]) => void;
}

type Filter = "all" | "disponiveis" | "fora" | "atencao" | EquipmentOwnership | "inactive";

const EMPTY_FIELDS: EquipmentFields = {
  name: "",
  patrimony: "",
  category: "",
  ownership_type: "proprio_ti",
  condition_status: "disponivel",
  origin: "",
  received_from: "",
  reason: "",
  notes: ""
};

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
  lockedCondition
}: {
  idPrefix: string;
  value: EquipmentFields;
  onChange: (v: EquipmentFields) => void;
  /** Motivo pelo qual a situação não pode ser alterada agora (ex.: está emprestado). */
  lockedCondition?: string;
}) {
  const set = <K extends keyof EquipmentFields>(key: K, v: EquipmentFields[K]) => onChange({ ...value, [key]: v });
  const conditionOptions = MANUAL_CONDITIONS.includes(value.condition_status)
    ? MANUAL_CONDITIONS
    : [value.condition_status, ...MANUAL_CONDITIONS];

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
          {lockedCondition ?? "\"Emprestado\" e \"Em uso\" por instalação são definidos pelas movimentações."}
        </p>
      </div>
      {value.ownership_type === "terceiro" && (
        <>
          <div>
            <label htmlFor={`${idPrefix}-from`} className="tw-label">Recebido de</label>
            <input id={`${idPrefix}-from`} value={value.received_from} onChange={(e) => set("received_from", e.target.value)} placeholder="Pessoa ou setor dono" className="tw-input" />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-origin`} className="tw-label">Origem</label>
            <input id={`${idPrefix}-origin`} value={value.origin} onChange={(e) => set("origin", e.target.value)} placeholder="Setor, sala ou fornecedor" className="tw-input" />
          </div>
        </>
      )}
      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-reason`} className="tw-label">Motivo de estar com o TI</label>
        <input id={`${idPrefix}-reason`} value={value.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Reserva técnica, formatação, conserto..." className="tw-input" />
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
  onCreate,
  onUpdate,
  onReturnToOwner,
  onOpenAudit,
  onPrintReport
}: EquipamentosPageProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<EquipmentFields | null>(null);
  const [editing, setEditing] = useState<{ item: CatalogEquipment; fields: EquipmentFields; active: boolean } | null>(null);
  const [details, setDetails] = useState<CatalogEquipment | null>(null);
  const [detailMovements, setDetailMovements] = useState<MovementItem[]>([]);
  const [returning, setReturning] = useState<{ item: CatalogEquipment; receivedBy: string; notes: string } | null>(null);
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

  const active = equipments.filter((e) => e.active === 1);
  const counts = {
    all: active.length,
    disponiveis: active.filter((e) => e.condition_status === "disponivel").length,
    fora: active.filter((e) => openByEquipment.has(e.id)).length,
    atencao: active.filter((e) => e.condition_status === "manutencao" || e.condition_status === "avaliacao").length,
    terceiro: active.filter((e) => e.ownership_type === "terceiro").length,
    inactive: equipments.length - active.length
  };

  const q = search.trim().toLowerCase();
  const filtered = equipments
    .filter((eq) => {
      if (filter === "inactive") return eq.active === 0;
      if (eq.active !== 1) return false;
      if (filter === "disponiveis") return eq.condition_status === "disponivel";
      if (filter === "fora") return openByEquipment.has(eq.id);
      if (filter === "atencao") return eq.condition_status === "manutencao" || eq.condition_status === "avaliacao";
      if (filter === "proprio_ti" || filter === "estoque" || filter === "terceiro") return eq.ownership_type === filter;
      return true;
    })
    .filter(
      (eq) =>
        !q ||
        [eq.name, eq.patrimony || "", eq.category, eq.origin, eq.received_from, eq.reason].join(" ").toLowerCase().includes(q)
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
      fields: {
        name: eq.name,
        patrimony: eq.patrimony || "",
        category: eq.category,
        ownership_type: eq.ownership_type,
        condition_status: eq.condition_status,
        origin: eq.origin,
        received_from: eq.received_from,
        reason: eq.reason,
        notes: eq.notes
      }
    });
  };

  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!creating) return;
    void run(async () => {
      await onCreate(creating);
      setCreating(null);
    }, "Erro ao cadastrar equipamento.");
  };

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const { item, fields } = editing;
    // Envia só o que mudou: evita conflitos com a situação controlada pelas movimentações.
    const patch: Partial<EquipmentFields & { active: boolean }> = {};
    (Object.keys(fields) as Array<keyof EquipmentFields>).forEach((key) => {
      const original = key === "patrimony" ? item.patrimony || "" : item[key];
      if (fields[key] !== original) (patch as Record<string, unknown>)[key] = fields[key];
    });
    if (editing.active !== (item.active === 1)) patch.active = editing.active;
    void run(async () => {
      if (Object.keys(patch).length > 0) await onUpdate(item, patch);
      setEditing(null);
    }, "Erro ao salvar equipamento.");
  };

  const submitReturnToOwner = (e: FormEvent) => {
    e.preventDefault();
    if (!returning) return;
    void run(async () => {
      await onReturnToOwner(returning.item, { received_by: returning.receivedBy, notes: returning.notes || undefined });
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
      return <span style={{ color: "var(--text-muted)" }}>Com o dono desde {formatDate(eq.owner_returned_at)}</span>;
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
        purpose="Acervo sob responsabilidade do TI: itens próprios, estoque e equipamentos recebidos de outros setores, com a situação e onde cada um está."
        howTo={[
          "Use \"Novo equipamento\" para cadastrar. A situação Emprestado é atualizada sozinha pelas movimentações.",
          "Filtre por disponíveis, fora, manutenção ou terceiros, ou busque por nome e patrimônio.",
          "Em Detalhes você vê o histórico. Equipamentos de terceiros podem ser devolvidos ao dono."
        ]}
        actions={
          <>
            <button type="button" className="tw-btn" onClick={() => onPrintReport(filtered)}>
              <Printer className="w-4 h-4" aria-hidden="true" /> PDF
            </button>
            <button type="button" className="tw-btn tw-btn-primary" onClick={() => { setError(null); setCreating({ ...EMPTY_FIELDS }); }}>
              <Plus className="w-4 h-4" aria-hidden="true" /> Novo equipamento
            </button>
          </>
        }
      />

      <section className="tw-card p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar equipamentos">
            {filterChip("all", "Todos", counts.all)}
            {filterChip("disponiveis", "Disponíveis", counts.disponiveis)}
            {filterChip("fora", "Fora do TI", counts.fora)}
            {filterChip("atencao", "Manutenção / avaliação", counts.atencao)}
            {filterChip("terceiro", "De terceiros", counts.terceiro)}
            {filterChip("inactive", "Inativos", counts.inactive)}
          </div>
          <input type="search" aria-label="Buscar equipamentos" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome, patrimônio, categoria..." className="tw-input lg:w-72" />
        </div>

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
                  <th scope="col">Posse</th>
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
                    <td data-label="Posse">
                      {OWNERSHIP_LABELS[eq.ownership_type]}
                      {eq.ownership_type === "terceiro" && eq.received_from && (
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>Recebido de {eq.received_from}</div>
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
                            onClick={() => { setError(null); setReturning({ item: eq, receivedBy: eq.received_from, notes: "" }); }}
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
      <dialog ref={createRef} aria-labelledby="new-eq-title" className="m-auto w-[min(96vw,640px)] max-h-[92vh] rounded-xl p-0 overflow-auto shadow-xl">
        {creating && (
          <form onSubmit={submitCreate} className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
              <h2 id="new-eq-title" className="text-base font-semibold">Novo equipamento</h2>
              <button type="button" aria-label="Fechar" className="tw-btn tw-btn-sm" onClick={() => setCreating(null)}><X className="w-4 h-4" /></button>
            </div>
            <EquipmentFormFields idPrefix="new-eq" value={creating} onChange={setCreating} />
            {errorBox}
            <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <button type="button" className="tw-btn" onClick={() => setCreating(null)}>Cancelar</button>
              <button type="submit" className="tw-btn tw-btn-primary" disabled={saving}>{saving ? "Salvando..." : "Cadastrar"}</button>
            </div>
          </form>
        )}
      </dialog>

      {/* Editar */}
      <dialog ref={editRef} aria-labelledby="edit-eq-title" className="m-auto w-[min(96vw,640px)] max-h-[92vh] rounded-xl p-0 overflow-auto shadow-xl">
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
              <button type="button" aria-label="Fechar" className="tw-btn tw-btn-sm" onClick={() => setDetails(null)}><X className="w-4 h-4" /></button>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Situação</dt><dd><span className="tw-badge" style={conditionStyle(details.condition_status)}>{CONDITION_LABELS[details.condition_status]}</span></dd></div>
              <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Onde está</dt><dd>{whereIs(details)}</dd></div>
              <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Posse</dt><dd>{OWNERSHIP_LABELS[details.ownership_type]}</dd></div>
              <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Categoria</dt><dd>{details.category || "-"}</dd></div>
              {details.ownership_type === "terceiro" && (
                <>
                  <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Recebido de</dt><dd>{details.received_from || "-"}</dd></div>
                  <div><dt className="text-xs" style={{ color: "var(--text-muted)" }}>Origem</dt><dd>{details.origin || "-"}</dd></div>
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
              O equipamento sai do acervo do TI (fica em Inativos) e o histórico é mantido.
            </p>
            <div>
              <label htmlFor="owner-received" className="tw-label">Quem recebeu <span aria-hidden="true">*</span></label>
              <input id="owner-received" required value={returning.receivedBy} onChange={(e) => setReturning({ ...returning, receivedBy: e.target.value })} className="tw-input" />
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
