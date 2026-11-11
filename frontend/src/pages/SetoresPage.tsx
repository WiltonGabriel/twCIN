import { ArrowDownLeft, ArrowUpRight, CheckCircle2, FileText, PackageCheck, Printer, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageIntro } from "../components/PageIntro";
import type { CatalogEquipment, CatalogSector, MovementItem } from "../types";
import {
  CONDITION_LABELS,
  conditionStyle,
  daysOverdue,
  formatDate,
  formatDateTime,
  isOverdue,
  movementStatusLabel,
  movementStatusStyle,
  OWNERSHIP_LABELS
} from "../types/labels";
import {
  collectSectorFilterOptions,
  isIsoInLocalDateRange,
  matchEquipmentSector,
  matchMovementSector
} from "../utils/sectorFilters";

interface SetoresPageProps {
  sectors: CatalogSector[];
  equipments: CatalogEquipment[];
  movements: MovementItem[];
  onPrintMovement: (item: MovementItem) => void;
  onPrintEquipmentReceipt: (item: CatalogEquipment) => void;
  onPrintDossier: (payload: {
    sectorName: string;
    periodLabel: string;
    movements: MovementItem[];
    thirdPartyItems: CatalogEquipment[];
    donatedItems: CatalogEquipment[];
  }) => void;
}

export function SetoresPage({
  sectors,
  equipments,
  movements,
  onPrintMovement,
  onPrintEquipmentReceipt,
  onPrintDossier
}: SetoresPageProps) {
  const sectorOptions = useMemo(
    () => collectSectorFilterOptions(sectors, equipments, movements),
    [sectors, equipments, movements]
  );

  const [selectedSectorName, setSelectedSectorName] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (sectorOptions.length === 0) return;
    if (selectedSectorName && sectorOptions.some((s) => s.name === selectedSectorName)) return;
    const def = sectors.find((s) => s.active === 1 && s.is_default === 1);
    const activeChoice = sectorOptions.find(
      (opt) =>
        movements.some((m) => matchMovementSector(m, opt)) ||
        equipments.some((eq) => matchEquipmentSector(eq, opt))
    );
    setSelectedSectorName(activeChoice?.name || def?.name || sectorOptions[0].name);
  }, [sectorOptions, selectedSectorName, sectors, movements, equipments]);

  const activeSector = useMemo(
    () => sectorOptions.find((s) => s.name === selectedSectorName) ?? null,
    [sectorOptions, selectedSectorName]
  );

  const q = search.trim().toLowerCase();

  const sectorMovements = useMemo(() => {
    if (!activeSector) return [];
    return movements
      .filter((m) => matchMovementSector(m, activeSector))
      .filter((m) => isIsoInLocalDateRange(m.out_at, fromDate, toDate) || isIsoInLocalDateRange(m.returned_at, fromDate, toDate))
      .filter(
        (m) =>
          !q ||
          [m.document_code, m.equipment_name, m.patrimony, m.install_location, m.received_by, m.notes]
            .join(" ")
            .toLowerCase()
            .includes(q)
      )
      .sort((a, b) => b.out_at.localeCompare(a.out_at));
  }, [activeSector, movements, fromDate, toDate, q]);

  const sectorEquipments = useMemo(() => {
    if (!activeSector) return [];
    return equipments
      .filter((eq) => matchEquipmentSector(eq, activeSector))
      .filter(
        (eq) =>
          isIsoInLocalDateRange(eq.received_at || eq.created_at, fromDate, toDate) ||
          isIsoInLocalDateRange(eq.owner_returned_at, fromDate, toDate)
      )
      .filter(
        (eq) =>
          !q ||
          [eq.name, eq.patrimony || "", eq.origin, eq.received_from, eq.owner_received_by || "", eq.reason, eq.notes]
            .join(" ")
            .toLowerCase()
            .includes(q)
      )
      .sort((a, b) => (b.received_at || b.created_at).localeCompare(a.received_at || a.created_at));
  }, [activeSector, equipments, fromDate, toDate, q]);

  const openMovements = sectorMovements.filter((m) => m.status === "ativo" || m.status === "fixo");
  const returnedMovements = sectorMovements.filter((m) => m.status === "devolvido");
  const thirdPartyWithTi = sectorEquipments.filter(
    (eq) => eq.ownership_type === "terceiro" && eq.condition_status !== "devolvido_dono"
  );
  const thirdPartyReturnedToSector = sectorEquipments.filter(
    (eq) => eq.ownership_type === "terceiro" && eq.condition_status === "devolvido_dono"
  );
  const donatedOrTransferred = sectorEquipments.filter((eq) => eq.ownership_type !== "terceiro");

  const periodLabel =
    fromDate || toDate
      ? `Período: ${fromDate ? formatDate(`${fromDate}T12:00:00`) : "início"} até ${toDate ? formatDate(`${toDate}T12:00:00`) : "hoje"}`
      : "Todo o período";

  return (
    <div className="space-y-5">
      <PageIntro
        title="Por Setor (Dossiê)"
        purpose="Veja em um único lugar tudo que envolve um setor: o que está com ele agora, o que ele trouxe para manutenção, o que já devolvemos ao dono e o que foi incorporado pela TI."
        howTo={[
          "Selecione o setor (ex.: Recursos Didáticos) para consultar pendências e comprovações.",
          "Filtre por período ou palavra-chave para localizar rapidamente um recebimento ou devolução.",
          "Use \"Imprimir dossiê PDF\" para gerar um relatório completo e apresentar ao setor."
        ]}
        actions={
          <button
            type="button"
            disabled={!activeSector}
            onClick={() => {
              if (!activeSector) return;
              onPrintDossier({
                sectorName: activeSector.name,
                periodLabel,
                movements: sectorMovements,
                thirdPartyItems: [...thirdPartyWithTi, ...thirdPartyReturnedToSector],
                donatedItems: donatedOrTransferred
              });
            }}
            className="tw-btn tw-btn-primary"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            Imprimir dossiê PDF
          </button>
        }
      />

      <section className="tw-card p-4 sm:p-5 space-y-4">
        <search>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-4">
              <label htmlFor="dossier-sector" className="tw-label">Setor</label>
              <select
                id="dossier-sector"
                value={selectedSectorName}
                onChange={(e) => setSelectedSectorName(e.target.value)}
                className="tw-input"
              >
                {sectorOptions.length === 0 && <option value="">Nenhum setor cadastrado</option>}
                {sectorOptions.map((opt) => (
                  <option key={opt.name} value={opt.name}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label htmlFor="dossier-from" className="tw-label">De</label>
              <input
                id="dossier-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="tw-input"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="dossier-to" className="tw-label">Até</label>
              <input
                id="dossier-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="tw-input"
              />
            </div>

            <div className="md:col-span-4 flex gap-2 items-end">
              <div className="flex-1">
                <label htmlFor="dossier-q" className="tw-label">Buscar neste setor</label>
                <div className="relative">
                  <Search
                    className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: "var(--text-muted)" }}
                    aria-hidden="true"
                  />
                  <input
                    id="dossier-q"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Equipamento, pessoa, código..."
                    className="tw-input"
                    style={{ paddingLeft: "2.4rem" }}
                  />
                </div>
              </div>
              {(fromDate || toDate || search) && (
                <button
                  type="button"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                    setSearch("");
                  }}
                  className="tw-btn shrink-0"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>
        </search>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="tw-stat">
          <span className="tw-stat-label">Da TI com o setor</span>
          <strong style={{ color: openMovements.length ? "var(--brand)" : undefined }}>{openMovements.length}</strong>
        </div>
        <div className="tw-stat">
          <span className="tw-stat-label">Do setor na TI agora</span>
          <strong style={{ color: thirdPartyWithTi.length ? "var(--warn)" : undefined }}>{thirdPartyWithTi.length}</strong>
        </div>
        <div className="tw-stat">
          <span className="tw-stat-label">Já devolvidos ao setor</span>
          <strong style={{ color: "var(--ok)" }}>{thirdPartyReturnedToSector.length}</strong>
        </div>
        <div className="tw-stat">
          <span className="tw-stat-label">Devoluções à TI / Doações</span>
          <strong>{returnedMovements.length + donatedOrTransferred.length}</strong>
        </div>
      </div>

      {/* 1. Itens da TI atualmente com o setor */}
      <section className="tw-card p-4 sm:p-5 space-y-3" aria-labelledby="dossier-open-title">
        <div className="flex items-center gap-2">
          <ArrowUpRight className="w-4 h-4" style={{ color: "var(--brand)" }} aria-hidden="true" />
          <h2 id="dossier-open-title" className="text-sm font-semibold">
            Equipamentos da TI atualmente com o setor ({openMovements.length})
          </h2>
        </div>

        {openMovements.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nenhum item da TI em aberto com este setor no filtro atual.
          </p>
        ) : (
          <div className="table-wrapper" role="region" aria-labelledby="dossier-open-title" tabIndex={0}>
            <table className="tw-table responsive-table">
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Equipamento</th>
                  <th scope="col">Local / Recebido por</th>
                  <th scope="col">Saída</th>
                  <th scope="col">Prazo / Situação</th>
                  <th scope="col"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {openMovements.map((m) => (
                  <tr key={m.client_uuid}>
                    <td data-label="Código" className="font-mono text-xs">{m.document_code}</td>
                    <td data-label="Equipamento">
                      <strong>{m.equipment_name}</strong>
                      {m.patrimony && <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{m.patrimony}</div>}
                    </td>
                    <td data-label="Local / Recebido por">
                      {m.install_location || "-"}
                      {m.received_by && <div className="text-xs" style={{ color: "var(--text-muted)" }}>Recebido por {m.received_by}</div>}
                    </td>
                    <td data-label="Saída">
                      {formatDateTime(m.out_at)}
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>por {m.registered_by_name}</div>
                    </td>
                    <td data-label="Prazo / Situação">
                      <span className="tw-badge" style={movementStatusStyle(m)}>{movementStatusLabel(m)}</span>
                      {m.status === "ativo" && m.due_at && (
                        <div className="text-xs mt-0.5" style={{ color: isOverdue(m) ? "var(--cin-red)" : "var(--text-muted)" }}>
                          {isOverdue(m) ? `${daysOverdue(m)}d de atraso` : `até ${formatDate(m.due_at)}`}
                        </div>
                      )}
                    </td>
                    <td>
                      <button type="button" className="tw-btn tw-btn-sm" onClick={() => onPrintMovement(m)}>
                        <Printer className="w-3.5 h-3.5" aria-hidden="true" /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 2. Itens trazidos pelo setor que estão na TI agora (manutenção/avaliação) */}
      <section className="tw-card p-4 sm:p-5 space-y-3" aria-labelledby="dossier-in-ti-title">
        <div className="flex items-center gap-2">
          <ArrowDownLeft className="w-4 h-4" style={{ color: "var(--warn)" }} aria-hidden="true" />
          <h2 id="dossier-in-ti-title" className="text-sm font-semibold">
            Do setor na TI agora — para conserto ou avaliação ({thirdPartyWithTi.length})
          </h2>
        </div>

        {thirdPartyWithTi.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nenhum equipamento deste setor aguardando devolução na TI.
          </p>
        ) : (
          <div className="table-wrapper" role="region" aria-labelledby="dossier-in-ti-title" tabIndex={0}>
            <table className="tw-table responsive-table">
              <thead>
                <tr>
                  <th scope="col">Equipamento</th>
                  <th scope="col">Entregue à TI por</th>
                  <th scope="col">Recebido em</th>
                  <th scope="col">Motivo</th>
                  <th scope="col">Situação</th>
                  <th scope="col"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {thirdPartyWithTi.map((eq) => (
                  <tr key={eq.client_uuid}>
                    <td data-label="Equipamento">
                      <strong>{eq.name}</strong>
                      {eq.patrimony && <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{eq.patrimony}</div>}
                    </td>
                    <td data-label="Entregue à TI por">{eq.received_from || "-"}</td>
                    <td data-label="Recebido em">
                      {formatDateTime(eq.received_at || eq.created_at)}
                      {eq.created_by_name && <div className="text-xs" style={{ color: "var(--text-muted)" }}>TI: {eq.created_by_name}</div>}
                    </td>
                    <td data-label="Motivo">{eq.reason || "-"}</td>
                    <td data-label="Situação">
                      <span className="tw-badge" style={conditionStyle(eq.condition_status)}>{CONDITION_LABELS[eq.condition_status]}</span>
                    </td>
                    <td>
                      <button type="button" className="tw-btn tw-btn-sm" onClick={() => onPrintEquipmentReceipt(eq)}>
                        <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Comprovante
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3. Comprovação: já devolvemos de volta para o setor */}
      <section className="tw-card p-4 sm:p-5 space-y-3" aria-labelledby="dossier-returned-owner-title">
        <div className="flex items-center gap-2">
          <PackageCheck className="w-4 h-4" style={{ color: "var(--ok)" }} aria-hidden="true" />
          <h2 id="dossier-returned-owner-title" className="text-sm font-semibold">
            Já entregues de volta ao setor — comprovação ({thirdPartyReturnedToSector.length})
          </h2>
        </div>

        {thirdPartyReturnedToSector.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nenhuma devolução ao dono registrada para este setor no filtro atual.
          </p>
        ) : (
          <div className="table-wrapper" role="region" aria-labelledby="dossier-returned-owner-title" tabIndex={0}>
            <table className="tw-table responsive-table">
              <thead>
                <tr>
                  <th scope="col">Equipamento</th>
                  <th scope="col">Recebido pela TI em</th>
                  <th scope="col">Entregue de volta em</th>
                  <th scope="col">Recebido de volta por</th>
                  <th scope="col">Entregue pelo TI</th>
                  <th scope="col"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {thirdPartyReturnedToSector.map((eq) => (
                  <tr key={eq.client_uuid}>
                    <td data-label="Equipamento">
                      <strong>{eq.name}</strong>
                      {eq.patrimony && <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{eq.patrimony}</div>}
                    </td>
                    <td data-label="Recebido pela TI em">
                      {formatDateTime(eq.received_at || eq.created_at)}
                      {eq.received_from && <div className="text-xs" style={{ color: "var(--text-muted)" }}>de {eq.received_from}</div>}
                    </td>
                    <td data-label="Entregue de volta em">{formatDateTime(eq.owner_returned_at)}</td>
                    <td data-label="Recebido de volta por"><strong>{eq.owner_received_by || "-"}</strong></td>
                    <td data-label="Entregue pelo TI">{eq.owner_returned_by_name || "-"}</td>
                    <td>
                      <button type="button" className="tw-btn tw-btn-sm" onClick={() => onPrintEquipmentReceipt(eq)}>
                        <Printer className="w-3.5 h-3.5" aria-hidden="true" /> Comprovante PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 4. Movimentações já devolvidas para a TI e itens doados/incorporados */}
      <section className="tw-card p-4 sm:p-5 space-y-4" aria-labelledby="dossier-history-title">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" style={{ color: "var(--ok)" }} aria-hidden="true" />
          <h2 id="dossier-history-title" className="text-sm font-semibold">
            Histórico encerrado e itens incorporados ao TI ({returnedMovements.length + donatedOrTransferred.length})
          </h2>
        </div>

        {returnedMovements.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Empréstimos já devolvidos à TI ({returnedMovements.length})
            </h3>
            <div className="table-wrapper" role="region" aria-label="Empréstimos devolvidos do setor" tabIndex={0}>
              <table className="tw-table responsive-table">
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Equipamento</th>
                    <th scope="col">Retirado por / Saída</th>
                    <th scope="col">Devolvido à TI em</th>
                    <th scope="col"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {returnedMovements.map((m) => (
                    <tr key={m.client_uuid}>
                      <td data-label="Código" className="font-mono text-xs">{m.document_code}</td>
                      <td data-label="Equipamento">{m.equipment_name}</td>
                      <td data-label="Retirado por / Saída">
                        {m.received_by || "-"} · {formatDateTime(m.out_at)}
                      </td>
                      <td data-label="Devolvido à TI em">
                        {formatDateTime(m.returned_at)}
                        {m.returned_to_name && <div className="text-xs" style={{ color: "var(--text-muted)" }}>TI: {m.returned_to_name}</div>}
                      </td>
                      <td>
                        <button type="button" className="tw-btn tw-btn-sm" onClick={() => onPrintMovement(m)}>
                          <Printer className="w-3.5 h-3.5" aria-hidden="true" /> PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {donatedOrTransferred.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Doações / itens repassados em definitivo ao TI ({donatedOrTransferred.length})
            </h3>
            <div className="table-wrapper" role="region" aria-label="Itens repassados ao TI pelo setor" tabIndex={0}>
              <table className="tw-table responsive-table">
                <thead>
                  <tr>
                    <th scope="col">Equipamento</th>
                    <th scope="col">Classificação</th>
                    <th scope="col">Entregue por</th>
                    <th scope="col">Recebido em</th>
                    <th scope="col">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {donatedOrTransferred.map((eq) => (
                    <tr key={eq.client_uuid}>
                      <td data-label="Equipamento">
                        <strong>{eq.name}</strong>
                        {eq.patrimony && <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{eq.patrimony}</div>}
                      </td>
                      <td data-label="Classificação">{OWNERSHIP_LABELS[eq.ownership_type]}</td>
                      <td data-label="Entregue por">{eq.received_from || "-"}</td>
                      <td data-label="Recebido em">{formatDateTime(eq.received_at || eq.created_at)}</td>
                      <td data-label="Situação">
                        <span className="tw-badge" style={conditionStyle(eq.condition_status)}>{CONDITION_LABELS[eq.condition_status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {returnedMovements.length === 0 && donatedOrTransferred.length === 0 && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nenhuma devolução encerrada nem repasse definitivo registrado para este setor no período.
          </p>
        )}
      </section>
    </div>
  );
}
