import { Printer, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CatalogEquipment, MovementItem, PublicSettings } from "../types";
import { CONDITION_LABELS, OWNERSHIP_LABELS } from "../types/labels";

export type PdfPayload =
  | { kind: "movement"; item: MovementItem }
  | { kind: "movements_report"; title: string; items: MovementItem[]; issuedBy: string }
  | { kind: "equipments_report"; title: string; items: CatalogEquipment[]; issuedBy: string }
  | { kind: "equipment_receipt"; item: CatalogEquipment }
  | {
      kind: "sector_dossier";
      sectorName: string;
      periodLabel: string;
      movements: MovementItem[];
      thirdPartyItems: CatalogEquipment[];
      donatedItems: CatalogEquipment[];
      issuedBy: string;
    };

interface PdfModalProps {
  payload: PdfPayload | null;
  settings: PublicSettings;
  onClose: () => void;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR");
}

export function PdfModal({ payload, settings, onClose }: PdfModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (payload && !dialog.open) {
      dialog.showModal();
    } else if (!payload && dialog.open) {
      dialog.close();
    }
  }, [payload]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  if (!payload) {
    return <dialog ref={dialogRef} className="hidden" />;
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="pdf-dialog-title"
      className="print-dialog m-auto w-[min(94vw,860px)] max-h-[90vh] rounded-xl p-0 overflow-auto shadow-xl"
    >
      <div
        className="no-print sticky top-0 z-10 px-5 py-3 border-b flex items-center justify-between gap-3"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <h2 id="pdf-dialog-title" className="text-sm font-semibold">
          Visualização para Impressão / PDF
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: "var(--brand)", color: "var(--brand-fg)" }}
          >
            <Printer className="w-3.5 h-3.5" aria-hidden="true" />
            Imprimir / Salvar PDF
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border cursor-pointer"
            style={{ borderColor: "var(--border)" }}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            Fechar
          </button>
        </div>
      </div>

      <div className="bg-white text-slate-900 p-6 sm:p-8 space-y-5 text-sm">
        <div className="flex items-center justify-between border-b border-slate-300 pb-4 gap-4">
          <div className="flex items-center gap-3">
            <img src={settings.logo_data_url || "/logo.svg"} alt={settings.app_name} className="h-10 w-auto" />
            <div>
              <div className="font-bold text-base text-[#002d6b]">
                {settings.org_name.toUpperCase()} — {settings.app_name}
              </div>
              {settings.org_subtitle && (
                <div className="text-xs text-slate-600">{settings.org_subtitle}</div>
              )}
              <div className="text-xs text-slate-600">
                {payload.kind === "movement"
                  ? "Comprovante de Movimentação / Empréstimo de Equipamento"
                  : payload.kind === "equipment_receipt"
                    ? payload.item.condition_status === "devolvido_dono"
                      ? "Comprovante de Devolução de Equipamento ao Setor / Dono"
                      : "Comprovante de Entrada de Equipamento na TI"
                    : payload.kind === "sector_dossier"
                      ? `Dossiê do Setor: ${payload.sectorName}${payload.periodLabel ? ` · ${payload.periodLabel}` : ""}`
                      : payload.title}
              </div>
              {(settings.org_document || settings.org_contact) && (
                <div className="text-[11px] text-slate-500">
                  {[settings.org_document, settings.org_contact].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          </div>

          {payload.kind === "movement" ? (
            <span className="font-mono text-xs font-bold px-2.5 py-1 rounded border border-slate-300 bg-slate-50">
              {payload.item.document_code}
            </span>
          ) : payload.kind === "equipment_receipt" ? (
            <span className="font-mono text-xs font-bold px-2.5 py-1 rounded border border-slate-300 bg-slate-50">
              EQ-{String(Math.abs(payload.item.id || 0)).padStart(4, "0")}
            </span>
          ) : (
            <span className="text-xs text-slate-600">
              Emitido em {formatDateTime(new Date().toISOString())} por {payload.issuedBy}
            </span>
          )}
        </div>

        {payload.kind === "movement" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs border border-slate-300 rounded-lg p-4">
              <div>
                <span className="text-slate-500 block">Equipamento</span>
                <strong className="text-sm">{payload.item.equipment_name}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">Nº do Patrimônio</span>
                <strong className="text-sm font-mono">{payload.item.patrimony || "-"}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">Setor de destino</span>
                <strong>{payload.item.sector_name}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">Local de instalação</span>
                <strong>{payload.item.install_location || "-"}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">Data / Hora de saída</span>
                <strong>{formatDateTime(payload.item.out_at)}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">Tipo</span>
                <strong>
                  {payload.item.movement_type === "instalacao_fixa" ? "Instalação fixa" : "Empréstimo"}
                </strong>
              </div>
              {payload.item.movement_type === "emprestimo" && (
                <div>
                  <span className="text-slate-500 block">Prazo de devolução</span>
                  <strong>{payload.item.due_at ? formatDateOnly(payload.item.due_at) : "Sem prazo definido"}</strong>
                </div>
              )}
              <div>
                <span className="text-slate-500 block">Registrado / Entregue por (TI)</span>
                <strong>{payload.item.registered_by_name}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">Recebido por</span>
                <strong>{payload.item.received_by || "-"}</strong>
              </div>
              {payload.item.status === "devolvido" && (
                <>
                  <div>
                    <span className="text-slate-500 block">Data / Hora de devolução</span>
                    <strong>{formatDateTime(payload.item.returned_at)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Recebido na volta por (TI)</span>
                    <strong>{payload.item.returned_to_name || "-"}</strong>
                  </div>
                </>
              )}
              {payload.item.notes && (
                <div className="sm:col-span-2">
                  <span className="text-slate-500 block">Observações</span>
                  <span>{payload.item.notes}</span>
                </div>
              )}
            </div>

            {payload.item.status !== "devolvido" && (
              <p className="text-xs leading-relaxed pt-4">
                Declaro ter recebido o equipamento acima em perfeito estado de funcionamento e me comprometo a zelar por ele
                {payload.item.movement_type === "emprestimo"
                  ? payload.item.due_at
                    ? ` e devolvê-lo ao setor de TI até ${formatDateOnly(payload.item.due_at)}`
                    : " e devolvê-lo ao setor de TI quando solicitado"
                  : " enquanto estiver instalado no local indicado"}
                , comunicando qualquer defeito, perda ou dano.
                {settings.loan_term_footer ? ` ${settings.loan_term_footer}` : ""}
              </p>
            )}

            <div className="pt-10 grid grid-cols-2 gap-10 text-center text-xs">
              <div className="border-t border-slate-500 pt-2">
                TI: {payload.item.registered_by_name}
              </div>
              <div className="border-t border-slate-500 pt-2">
                Recebido por: {payload.item.received_by || "____________________________"}
              </div>
            </div>
          </>
        )}

        {payload.kind === "movements_report" && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-400 text-left">
                <th scope="col" className="py-2 pr-2">Código</th>
                <th scope="col" className="py-2 pr-2">Equipamento / Patrimônio</th>
                <th scope="col" className="py-2 pr-2">Setor / Local</th>
                <th scope="col" className="py-2 pr-2">Recebido por</th>
                <th scope="col" className="py-2 pr-2">TI</th>
                <th scope="col" className="py-2 pr-2">Saída</th>
                <th scope="col" className="py-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {payload.items.map((m) => (
                <tr key={m.client_uuid} className="border-b border-slate-200">
                  <td className="py-2 pr-2 font-mono">{m.document_code}</td>
                  <td className="py-2 pr-2">
                    {m.equipment_name}
                    {m.patrimony ? ` (${m.patrimony})` : ""}
                  </td>
                  <td className="py-2 pr-2">
                    {m.sector_name}
                    {m.install_location ? ` — ${m.install_location}` : ""}
                  </td>
                  <td className="py-2 pr-2">{m.received_by || "-"}</td>
                  <td className="py-2 pr-2">{m.registered_by_name}</td>
                  <td className="py-2 pr-2">{formatDateTime(m.out_at)}</td>
                  <td className="py-2">
                    {m.status === "devolvido"
                      ? `Devolvido (${formatDateTime(m.returned_at)})`
                      : m.status === "fixo"
                        ? "Instalação fixa"
                        : "Fora"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {payload.kind === "equipments_report" && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-400 text-left">
                <th scope="col" className="py-2 pr-2">Equipamento</th>
                <th scope="col" className="py-2 pr-2">Patrimônio</th>
                <th scope="col" className="py-2 pr-2">Classificação</th>
                <th scope="col" className="py-2 pr-2">Situação</th>
                <th scope="col" className="py-2 pr-2">Origem / Recebido de</th>
                <th scope="col" className="py-2 pr-2">Recebido em</th>
                <th scope="col" className="py-2">Devolução / Motivo</th>
              </tr>
            </thead>
            <tbody>
              {payload.items.map((eq) => (
                <tr key={eq.client_uuid} className="border-b border-slate-200">
                  <td className="py-2 pr-2">{eq.name}</td>
                  <td className="py-2 pr-2 font-mono">{eq.patrimony || "-"}</td>
                  <td className="py-2 pr-2">{OWNERSHIP_LABELS[eq.ownership_type]}</td>
                  <td className="py-2 pr-2">{CONDITION_LABELS[eq.condition_status]}</td>
                  <td className="py-2 pr-2">
                    {eq.origin || "-"}
                    {eq.received_from ? ` (${eq.received_from})` : ""}
                  </td>
                  <td className="py-2 pr-2">{formatDateOnly(eq.received_at || eq.created_at)}</td>
                  <td className="py-2">
                    {eq.condition_status === "devolvido_dono"
                      ? `Devolvido ${formatDateOnly(eq.owner_returned_at)} (${eq.owner_received_by || "-"})`
                      : eq.reason || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {payload.kind === "equipment_receipt" && (() => {
          const eq = payload.item;
          const returnedToOwner = eq.condition_status === "devolvido_dono";
          return (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs border border-slate-300 rounded-lg p-4">
                <div>
                  <span className="text-slate-500 block">Equipamento</span>
                  <strong className="text-sm">{eq.name}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Nº do Patrimônio</span>
                  <strong className="text-sm font-mono">{eq.patrimony || "-"}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Categoria / Classificação</span>
                  <strong>{[eq.category, OWNERSHIP_LABELS[eq.ownership_type]].filter(Boolean).join(" · ")}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Situação atual</span>
                  <strong>{CONDITION_LABELS[eq.condition_status]}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Setor / Origem</span>
                  <strong>{eq.origin || "-"}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Entregue à TI por</span>
                  <strong>{eq.received_from || "-"}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Data / Hora de recebimento na TI</span>
                  <strong>{formatDateTime(eq.received_at || eq.created_at)}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Recebido / registrado na TI por</span>
                  <strong>{eq.created_by_name || "-"}</strong>
                </div>
                {returnedToOwner && (
                  <>
                    <div>
                      <span className="text-slate-500 block">Data / Hora de entrega de volta ao setor</span>
                      <strong>{formatDateTime(eq.owner_returned_at)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Recebido de volta por (setor / dono)</span>
                      <strong>{eq.owner_received_by || "-"}</strong>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-slate-500 block">Devolvido pela TI por</span>
                      <strong>{eq.owner_returned_by_name || "-"}</strong>
                    </div>
                  </>
                )}
                {eq.reason && (
                  <div className="sm:col-span-2">
                    <span className="text-slate-500 block">Motivo / solicitação</span>
                    <span>{eq.reason}</span>
                  </div>
                )}
                {eq.notes && (
                  <div className="sm:col-span-2">
                    <span className="text-slate-500 block">Observações</span>
                    <span className="whitespace-pre-line">{eq.notes}</span>
                  </div>
                )}
              </div>

              <p className="text-xs leading-relaxed pt-4">
                {returnedToOwner
                  ? "Confirmamos a entrega de volta do equipamento acima ao setor ou responsável de origem nas condições descritas."
                  : "Confirmamos o recebimento do equipamento acima pelo setor de TI para avaliação, manutenção ou atendimento."}
                {settings.loan_term_footer ? ` ${settings.loan_term_footer}` : ""}
              </p>

              <div className="pt-10 grid grid-cols-2 gap-10 text-center text-xs">
                <div className="border-t border-slate-500 pt-2">
                  TI: {returnedToOwner ? eq.owner_returned_by_name || eq.created_by_name : eq.created_by_name || "____________________________"}
                </div>
                <div className="border-t border-slate-500 pt-2">
                  Setor / Responsável: {returnedToOwner ? eq.owner_received_by || "____________________________" : eq.received_from || "____________________________"}
                </div>
              </div>
            </>
          );
        })()}

        {payload.kind === "sector_dossier" && (
          <div className="space-y-6 text-xs">
            <section className="space-y-2">
              <h3 className="text-sm font-bold border-b border-slate-300 pb-1">
                1. Movimentações da TI para o setor ({payload.movements.length})
              </h3>
              {payload.movements.length === 0 ? (
                <p className="text-slate-500">Nenhuma movimentação encontrada para este setor no filtro selecionado.</p>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-slate-400 text-left">
                      <th scope="col" className="py-1.5 pr-2">Código</th>
                      <th scope="col" className="py-1.5 pr-2">Equipamento</th>
                      <th scope="col" className="py-1.5 pr-2">Local</th>
                      <th scope="col" className="py-1.5 pr-2">Recebido por</th>
                      <th scope="col" className="py-1.5 pr-2">Saída</th>
                      <th scope="col" className="py-1.5">Situação / Devolução</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.movements.map((m) => (
                      <tr key={m.client_uuid} className="border-b border-slate-200">
                        <td className="py-1.5 pr-2 font-mono">{m.document_code}</td>
                        <td className="py-1.5 pr-2">{m.equipment_name}{m.patrimony ? ` (${m.patrimony})` : ""}</td>
                        <td className="py-1.5 pr-2">{m.install_location || "-"}</td>
                        <td className="py-1.5 pr-2">{m.received_by || "-"}</td>
                        <td className="py-1.5 pr-2">{formatDateTime(m.out_at)}</td>
                        <td className="py-1.5">
                          {m.status === "devolvido"
                            ? `Devolvido à TI em ${formatDateTime(m.returned_at)}${m.returned_to_name ? ` (TI: ${m.returned_to_name})` : ""}`
                            : m.status === "fixo"
                              ? "Instalação fixa no setor"
                              : `Com o setor${m.due_at ? ` · até ${formatDateOnly(m.due_at)}` : ""}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-bold border-b border-slate-300 pb-1">
                2. Equipamentos do setor recebidos na TI (manutenção / devolvidos ao dono) ({payload.thirdPartyItems.length})
              </h3>
              {payload.thirdPartyItems.length === 0 ? (
                <p className="text-slate-500">Nenhum equipamento de terceiro registrado para este setor no período.</p>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-slate-400 text-left">
                      <th scope="col" className="py-1.5 pr-2">Equipamento</th>
                      <th scope="col" className="py-1.5 pr-2">Entregue à TI por</th>
                      <th scope="col" className="py-1.5 pr-2">Recebido em</th>
                      <th scope="col" className="py-1.5 pr-2">Motivo</th>
                      <th scope="col" className="py-1.5">Situação / Devolução ao dono</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.thirdPartyItems.map((eq) => (
                      <tr key={eq.client_uuid} className="border-b border-slate-200">
                        <td className="py-1.5 pr-2">{eq.name}{eq.patrimony ? ` (${eq.patrimony})` : ""}</td>
                        <td className="py-1.5 pr-2">{eq.received_from || "-"}</td>
                        <td className="py-1.5 pr-2">{formatDateTime(eq.received_at || eq.created_at)}</td>
                        <td className="py-1.5 pr-2">{eq.reason || "-"}</td>
                        <td className="py-1.5">
                          {eq.condition_status === "devolvido_dono"
                            ? `Entregue ao setor em ${formatDateTime(eq.owner_returned_at)} · Recebido por ${eq.owner_received_by || "-"}`
                            : `Na TI (${CONDITION_LABELS[eq.condition_status]})`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {payload.donatedItems.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-bold border-b border-slate-300 pb-1">
                  3. Itens repassados / incorporados ao TI ({payload.donatedItems.length})
                </h3>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-slate-400 text-left">
                      <th scope="col" className="py-1.5 pr-2">Equipamento</th>
                      <th scope="col" className="py-1.5 pr-2">Classificação</th>
                      <th scope="col" className="py-1.5 pr-2">Recebido de</th>
                      <th scope="col" className="py-1.5 pr-2">Recebido em</th>
                      <th scope="col" className="py-1.5">Situação atual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.donatedItems.map((eq) => (
                      <tr key={eq.client_uuid} className="border-b border-slate-200">
                        <td className="py-1.5 pr-2">{eq.name}{eq.patrimony ? ` (${eq.patrimony})` : ""}</td>
                        <td className="py-1.5 pr-2">{OWNERSHIP_LABELS[eq.ownership_type]}</td>
                        <td className="py-1.5 pr-2">{eq.received_from || "-"}</td>
                        <td className="py-1.5 pr-2">{formatDateOnly(eq.received_at || eq.created_at)}</td>
                        <td className="py-1.5">{CONDITION_LABELS[eq.condition_status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
