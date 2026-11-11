import { AlertTriangle, ArrowRight, Check, Package, Printer, Search, Wrench } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { PageIntro } from "../components/PageIntro";
import type { CatalogEquipment, MovementItem, PageKey } from "../types";
import {
  CONDITION_LABELS,
  conditionStyle,
  daysOverdue,
  formatDate,
  formatDateTime,
  isOverdue,
  movementStatusLabel,
  movementStatusStyle
} from "../types/labels";

const GraficosPage = lazy(() => import("./GraficosPage").then((m) => ({ default: m.GraficosPage })));

interface InicioPageProps {
  equipments: CatalogEquipment[];
  movements: MovementItem[];
  onNavigate: (page: PageKey) => void;
  onQuickUpdateEquipment: (
    item: CatalogEquipment,
    patch: Partial<{ condition_status: CatalogEquipment["condition_status"] }>
  ) => Promise<void>;
  onQuickReturnMovement: (item: MovementItem) => Promise<void>;
  onPrintMovement: (item: MovementItem) => void;
}

export function InicioPage({
  equipments,
  movements,
  onNavigate,
  onQuickUpdateEquipment,
  onQuickReturnMovement,
  onPrintMovement
}: InicioPageProps) {
  const [view, setView] = useState<"geral" | "indicadores">("geral");
  const [search, setSearch] = useState("");
  const [returning, setReturning] = useState<MovementItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (returning && !d.open) d.showModal();
    else if (!returning && d.open) d.close();
  }, [returning]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const handler = () => setReturning(null);
    d.addEventListener("close", handler);
    return () => d.removeEventListener("close", handler);
  }, []);

  const activeEquipments = equipments.filter((e) => e.active === 1);
  const attention = activeEquipments.filter((e) => e.condition_status === "manutencao" || e.condition_status === "avaliacao");
  const openLoans = movements.filter((m) => m.status === "ativo");
  const overdue = openLoans.filter((m) => isOverdue(m)).sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
  const dueSoon = openLoans
    .filter((m) => !isOverdue(m) && m.due_at && new Date(m.due_at).getTime() - Date.now() < 2 * 24 * 60 * 60 * 1000)
    .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
  const available = activeEquipments.filter((e) => e.condition_status === "disponivel").length;

  const q = search.trim().toLowerCase();
  const matchedEquipments = q
    ? equipments
        .filter((e) => e.active === 1 || e.condition_status === "devolvido_dono")
        .filter((e) =>
          [e.name, e.patrimony || "", e.category, e.origin, e.received_from, e.owner_received_by || "", e.reason]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
        .slice(0, 8)
    : [];
  const matchedMovements = q
    ? movements
        .filter((m) =>
          [m.document_code, m.equipment_name, m.patrimony, m.sector_name, m.install_location, m.received_by]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
        .slice(0, 8)
    : [];

  const confirmReturn = async () => {
    if (!returning) return;
    setBusy(true);
    setError(null);
    try {
      await onQuickReturnMovement(returning);
      setReturning(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registrar devolução.");
    } finally {
      setBusy(false);
    }
  };

  const markAvailable = async (eq: CatalogEquipment) => {
    setError(null);
    try {
      await onQuickUpdateEquipment(eq, { condition_status: "disponivel" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar equipamento.");
    }
  };

  const loanRow = (m: MovementItem) => (
    <li key={m.client_uuid} className="tw-card px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2" style={{ backgroundColor: "var(--bg)" }}>
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">
          <span className="font-mono text-xs mr-1.5" style={{ color: "var(--text-muted)" }}>{m.document_code}</span>
          {m.equipment_name}
        </div>
        <div className="text-xs" style={{ color: isOverdue(m) ? "var(--cin-red)" : "var(--text-muted)" }}>
          {m.sector_name}
          {m.received_by ? ` · ${m.received_by}` : ""}
          {m.due_at
            ? isOverdue(m)
              ? daysOverdue(m) > 0
                ? ` · ${daysOverdue(m)} dia(s) de atraso`
                : " · Vencido hoje"
              : ` · até ${formatDate(m.due_at)}`
            : ""}
        </div>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <button type="button" className="tw-btn tw-btn-sm" onClick={() => onPrintMovement(m)} aria-label={`PDF de ${m.document_code}`}>
          <Printer className="w-3.5 h-3.5" aria-hidden="true" /> PDF
        </button>
        <button type="button" className="tw-btn tw-btn-sm tw-btn-ok" onClick={() => setReturning(m)}>
          <Check className="w-3.5 h-3.5" aria-hidden="true" /> Registrar devolução
        </button>
      </div>
    </li>
  );

  return (
    <div className="space-y-5">
      <PageIntro
        title="Início"
        purpose="Visão rápida do TI: o que está fora, o que está atrasado, o que está em manutenção e indicadores do acervo."
        howTo={[
          "Busque por equipamento, patrimônio, setor, código ou pessoa.",
          "Acompanhe atrasados e registre devoluções direto daqui.",
          "Abra \"Indicadores\" para ver os gráficos do acervo e das movimentações."
        ]}
        actions={
          <div role="tablist" aria-label="Visões do início" className="flex gap-1 p-1 rounded-lg border" style={{ borderColor: "var(--border)" }}>
            {(["geral", "indicadores"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className="px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer"
                style={view === v ? { backgroundColor: "var(--brand)", color: "var(--brand-fg)" } : { color: "var(--text-muted)" }}
              >
                {v === "geral" ? "Visão geral" : "Indicadores"}
              </button>
            ))}
          </div>
        }
      />

      {view === "indicadores" ? (
        <Suspense fallback={<p className="text-sm" style={{ color: "var(--text-muted)" }}>Carregando indicadores...</p>}>
          <GraficosPage equipments={equipments} movements={movements} />
        </Suspense>
      ) : (
        <>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} aria-hidden="true" />
            <input
              type="search"
              aria-label="Consulta rápida"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar equipamento, patrimônio, setor, código ou pessoa"
              className="tw-input"
              style={{ paddingLeft: "2.5rem" }}
            />
          </div>

          {error && (
            <div role="alert" className="px-3 py-2 rounded-lg text-sm border" style={{ backgroundColor: "var(--cin-red-soft)", borderColor: "var(--cin-red)", color: "var(--cin-red)" }}>
              {error}
            </div>
          )}

          {q ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <section className="tw-card p-4 space-y-2">
                <h2 className="text-sm font-semibold">Equipamentos ({matchedEquipments.length})</h2>
                {matchedEquipments.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>Nenhum equipamento encontrado.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {matchedEquipments.map((e) => (
                      <li key={e.client_uuid} className="tw-card px-3 py-2 flex items-center justify-between gap-2" style={{ backgroundColor: "var(--bg)" }}>
                        <span className="text-sm min-w-0">
                          <strong>{e.name}</strong>
                          {e.patrimony && <span className="font-mono text-xs ml-1.5" style={{ color: "var(--text-muted)" }}>{e.patrimony}</span>}
                          {(e.origin || e.condition_status === "devolvido_dono") && (
                            <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                              {e.origin ? `Origem: ${e.origin}` : ""}
                              {e.condition_status === "devolvido_dono"
                                ? `${e.origin ? " · " : ""}Devolvido ao dono em ${formatDateTime(e.owner_returned_at)}${e.owner_received_by ? ` (${e.owner_received_by})` : ""}`
                                : ""}
                            </span>
                          )}
                        </span>
                        <span className="tw-badge shrink-0" style={conditionStyle(e.condition_status)}>{CONDITION_LABELS[e.condition_status]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="tw-card p-4 space-y-2">
                <h2 className="text-sm font-semibold">Movimentações ({matchedMovements.length})</h2>
                {matchedMovements.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>Nenhuma movimentação encontrada.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {matchedMovements.map((m) => (
                      <li key={m.client_uuid} className="tw-card px-3 py-2 flex items-center justify-between gap-2" style={{ backgroundColor: "var(--bg)" }}>
                        <span className="text-sm min-w-0">
                          <span className="font-mono text-xs mr-1.5" style={{ color: "var(--text-muted)" }}>{m.document_code}</span>
                          <strong>{m.equipment_name}</strong>
                          <span className="block text-xs" style={{ color: "var(--text-muted)" }}>{m.sector_name} · {formatDateTime(m.out_at)}</span>
                        </span>
                        <span className="tw-badge shrink-0" style={movementStatusStyle(m)}>{movementStatusLabel(m)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <button type="button" className="tw-stat text-left cursor-pointer" onClick={() => onNavigate("equipamentos")}>
                  <span className="tw-stat-label">Disponíveis no TI</span>
                  <strong style={{ color: "var(--ok)" }}>{available}</strong>
                </button>
                <button type="button" className="tw-stat text-left cursor-pointer" onClick={() => onNavigate("movimentacoes")}>
                  <span className="tw-stat-label">Emprestados</span>
                  <strong style={{ color: "var(--brand)" }}>{openLoans.length}</strong>
                </button>
                <button type="button" className="tw-stat text-left cursor-pointer" onClick={() => onNavigate("movimentacoes")}>
                  <span className="tw-stat-label">Atrasados</span>
                  <strong style={{ color: overdue.length ? "var(--cin-red)" : undefined }}>{overdue.length}</strong>
                </button>
                <button type="button" className="tw-stat text-left cursor-pointer" onClick={() => onNavigate("equipamentos")}>
                  <span className="tw-stat-label">Manutenção / avaliação</span>
                  <strong style={{ color: attention.length ? "var(--warn)" : undefined }}>{attention.length}</strong>
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <section className="tw-card p-4 space-y-3" aria-labelledby="home-overdue">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="home-overdue" className="text-sm font-semibold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" style={{ color: overdue.length ? "var(--cin-red)" : "var(--text-muted)" }} aria-hidden="true" />
                      Atrasados e vencendo
                    </h2>
                    <button type="button" className="text-xs font-semibold inline-flex items-center gap-1 cursor-pointer" style={{ color: "var(--brand)" }} onClick={() => onNavigate("movimentacoes")}>
                      Ver todos <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  {overdue.length + dueSoon.length === 0 ? (
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>Nenhum empréstimo atrasado ou vencendo nos próximos 2 dias.</p>
                  ) : (
                    <ul className="space-y-1.5">{[...overdue, ...dueSoon].slice(0, 8).map(loanRow)}</ul>
                  )}
                </section>

                <section className="tw-card p-4 space-y-3" aria-labelledby="home-attention">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="home-attention" className="text-sm font-semibold flex items-center gap-2">
                      <Wrench className="w-4 h-4" style={{ color: "var(--warn)" }} aria-hidden="true" />
                      Em manutenção ou avaliação
                    </h2>
                    <button type="button" className="text-xs font-semibold inline-flex items-center gap-1 cursor-pointer" style={{ color: "var(--brand)" }} onClick={() => onNavigate("equipamentos")}>
                      Ver todos <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  {attention.length === 0 ? (
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>Nenhum equipamento em manutenção ou avaliação.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {attention.slice(0, 8).map((eq) => (
                        <li key={eq.client_uuid} className="tw-card px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2" style={{ backgroundColor: "var(--bg)" }}>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold flex items-center gap-2">
                              <span className="tw-badge" style={conditionStyle(eq.condition_status)}>{CONDITION_LABELS[eq.condition_status]}</span>
                              <span className="truncate">{eq.name}</span>
                            </div>
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                              {eq.ownership_type === "terceiro" && eq.received_from ? `Recebido de ${eq.received_from}` : eq.patrimony || "Sem patrimônio"}
                              {eq.reason ? ` · ${eq.reason}` : ""}
                            </div>
                          </div>
                          <button type="button" className="tw-btn tw-btn-sm shrink-0" onClick={() => void markAvailable(eq)}>
                            <Package className="w-3.5 h-3.5" aria-hidden="true" /> Marcar disponível
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <section className="tw-card p-4 space-y-3" aria-labelledby="home-open">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="home-open" className="text-sm font-semibold">Emprestados agora ({openLoans.length})</h2>
                  <button type="button" className="text-xs font-semibold inline-flex items-center gap-1 cursor-pointer" style={{ color: "var(--brand)" }} onClick={() => onNavigate("movimentacoes")}>
                    Gerenciar <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
                {openLoans.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>Nenhum equipamento emprestado.</p>
                ) : (
                  <ul className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">{openLoans.slice(0, 10).map(loanRow)}</ul>
                )}
              </section>
            </>
          )}
        </>
      )}

      <dialog ref={dialogRef} aria-labelledby="home-return-title" className="m-auto w-[min(94vw,440px)] rounded-xl p-5 shadow-xl">
        {returning && (
          <div className="space-y-4">
            <h2 id="home-return-title" className="text-base font-semibold">Registrar devolução?</h2>
            <p className="text-sm">
              <strong>{returning.equipment_name}</strong> ({returning.document_code}) volta do setor <strong>{returning.sector_name}</strong> e fica disponível no TI.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="tw-btn" onClick={() => setReturning(null)}>Cancelar</button>
              <button type="button" className="tw-btn tw-btn-ok" disabled={busy} onClick={() => void confirmReturn()}>
                {busy ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
