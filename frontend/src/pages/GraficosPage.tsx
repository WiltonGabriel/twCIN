import { useState } from "react";
import type { CatalogEquipment, EquipmentCondition, EquipmentOwnership, MovementItem } from "../types";

interface GraficosPageProps {
  equipments: CatalogEquipment[];
  movements: MovementItem[];
}

const CONDITION_META: Array<{ key: EquipmentCondition; label: string; color: string }> = [
  { key: "disponivel", label: "Disponível", color: "var(--ok)" },
  { key: "em_uso", label: "Em uso", color: "var(--brand)" },
  { key: "emprestado", label: "Emprestado", color: "#0284c7" },
  { key: "manutencao", label: "Manutenção", color: "var(--warn)" },
  { key: "avaliacao", label: "Avaliação", color: "#d97706" },
  { key: "descartado", label: "Descartado", color: "var(--cin-red)" },
  { key: "devolvido_dono", label: "Devolvido ao dono", color: "var(--text-muted)" }
];

const OWNERSHIP_META: Array<{ key: EquipmentOwnership; label: string; color: string }> = [
  { key: "proprio_ti", label: "Próprio do TI", color: "var(--brand)" },
  { key: "estoque", label: "Em estoque", color: "var(--ok)" },
  { key: "terceiro", label: "Recebido de terceiros / setor", color: "var(--warn)" }
];

function groupTop(items: string[], limit = 6): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const raw of items) {
    const label = raw.trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"))
    .slice(0, limit);
}

function HorizontalBarCard({
  title,
  rows,
  emptyText,
  barColor = "var(--brand)"
}: {
  title: string;
  rows: Array<{ label: string; count: number; color?: string }>;
  emptyText: string;
  barColor?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((acc, r) => acc + r.count, 0);

  return (
    <figure
      className="rounded-xl border p-5 shadow-sm space-y-3"
      style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
    >
      <figcaption className="text-sm font-semibold border-b pb-2.5" style={{ borderColor: "var(--border)" }}>
        {title}
      </figcaption>

      {rows.length === 0 || total === 0 ? (
        <p className="text-xs py-4" style={{ color: "var(--text-muted)" }}>
          {emptyText}
        </p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => {
            const pct = Math.round((row.count / max) * 100);
            const share = total > 0 ? Math.round((row.count / total) * 100) : 0;
            return (
              <div key={row.label} className="space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{row.label}</span>
                  <span className="font-mono shrink-0" style={{ color: "var(--text-muted)" }}>
                    {row.count} ({share}%)
                  </span>
                </div>
                <div
                  className="h-2.5 w-full rounded-full overflow-hidden"
                  style={{ backgroundColor: "var(--surface-alt)" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(pct, row.count > 0 ? 4 : 0)}%`,
                      backgroundColor: row.color || barColor
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </figure>
  );
}

export function GraficosPage({ equipments, movements }: GraficosPageProps) {
  const [periodDays, setPeriodDays] = useState<7 | 30 | 90 | 0>(30);

  const nowMs = Date.now();
  const filteredMovements =
    periodDays === 0
      ? movements
      : movements.filter((m) => {
          const t = new Date(m.out_at).getTime();
          return Number.isFinite(t) && nowMs - t <= periodDays * 86400 * 1000;
        });

  const activeEquipments = equipments.filter((e) => e.active === 1);
  const activeLoansCount = movements.filter((m) => m.status === "ativo").length;
  const maintenanceCount = activeEquipments.filter(
    (e) => e.condition_status === "manutencao" || e.condition_status === "avaliacao"
  ).length;

  // 1. Equipments by condition
  const conditionRows = CONDITION_META.map((meta) => ({
    label: meta.label,
    count: activeEquipments.filter((e) => e.condition_status === meta.key).length,
    color: meta.color
  })).filter((r) => r.count > 0);

  // 2. Equipments by ownership (Donut)
  const ownershipCounts = OWNERSHIP_META.map((meta) => ({
    ...meta,
    count: activeEquipments.filter((e) => e.ownership_type === meta.key).length
  }));
  const ownershipTotal = ownershipCounts.reduce((acc, x) => acc + x.count, 0);

  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  let cumulativeOffset = 0;
  const donutSegments = ownershipCounts.map((item) => {
    const fraction = ownershipTotal > 0 ? item.count / ownershipTotal : 0;
    const dashLength = fraction * circumference;
    const segment = {
      ...item,
      dashArray: `${dashLength} ${circumference - dashLength}`,
      dashOffset: -cumulativeOffset
    };
    cumulativeOffset += dashLength;
    return segment;
  });

  // 3. Daily movements (last 14 days)
  const timelineDays: Array<{ key: string; label: string; out: number; returned: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(nowMs - i * 86400 * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const label = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    timelineDays.push({ key, label, out: 0, returned: 0 });
  }
  for (const m of movements) {
    const outD = new Date(m.out_at);
    const outKey = `${outD.getFullYear()}-${String(outD.getMonth() + 1).padStart(2, "0")}-${String(outD.getDate()).padStart(2, "0")}`;
    const outBucket = timelineDays.find((d) => d.key === outKey);
    if (outBucket) outBucket.out++;

    if (m.returned_at) {
      const retD = new Date(m.returned_at);
      const retKey = `${retD.getFullYear()}-${String(retD.getMonth() + 1).padStart(2, "0")}-${String(retD.getDate()).padStart(2, "0")}`;
      const retBucket = timelineDays.find((d) => d.key === retKey);
      if (retBucket) retBucket.returned++;
    }
  }
  const maxDaily = Math.max(1, ...timelineDays.map((d) => Math.max(d.out, d.returned)));

  // 4. Top sectors, locations, equipments, technicians
  const sectorRows = groupTop(filteredMovements.map((m) => m.sector_name));
  const locationRows = groupTop(filteredMovements.map((m) => m.install_location));
  const topEquipmentRows = groupTop(filteredMovements.map((m) => m.equipment_name));
  const technicianRows = groupTop([
    ...filteredMovements.map((m) => m.registered_by_name),
    ...filteredMovements.filter((m) => m.returned_to_name).map((m) => m.returned_to_name as string)
  ]);

  // 5. Movement status breakdown
  const statusBreakdownRows = [
    {
      label: "Emprestados (em aberto)",
      count: filteredMovements.filter((m) => m.status === "ativo").length,
      color: "var(--brand)"
    },
    {
      label: "Devolvido",
      count: filteredMovements.filter((m) => m.status === "devolvido").length,
      color: "var(--ok)"
    },
    {
      label: "Instalação fixa",
      count: filteredMovements.filter((m) => m.status === "fixo").length,
      color: "#64748b"
    }
  ].filter((r) => r.count > 0);

  return (
    <div className="space-y-5">

      {/* Header + Period Filter */}
      <section
        className="rounded-xl border p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div>
          <h2 className="text-base font-semibold">Período de Análise</h2>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Período das movimentações">
          {[
            { days: 7 as const, label: "7 dias" },
            { days: 30 as const, label: "30 dias" },
            { days: 90 as const, label: "90 dias" },
            { days: 0 as const, label: "Tudo" }
          ].map((opt) => (
            <button
              key={opt.days}
              type="button"
              onClick={() => setPeriodDays(opt.days)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer"
              style={
                periodDays === opt.days
                  ? { backgroundColor: "var(--brand)", color: "var(--brand-fg)", borderColor: "var(--brand)" }
                  : { borderColor: "var(--border)", color: "var(--text-muted)" }
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Equipamentos ativos</span>
          <div className="text-2xl font-bold mt-1">{activeEquipments.length}</div>
        </div>
        <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Manutenção / avaliação</span>
          <div className="text-2xl font-bold mt-1" style={{ color: maintenanceCount > 0 ? "var(--warn)" : undefined }}>
            {maintenanceCount}
          </div>
        </div>
        <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Emprestados (em aberto)</span>
          <div className="text-2xl font-bold mt-1" style={{ color: "var(--brand)" }}>
            {activeLoansCount}
          </div>
        </div>
        <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Movimentações no período</span>
          <div className="text-2xl font-bold mt-1">{filteredMovements.length}</div>
        </div>
      </div>

      {/* Daily Timeline Chart (14 days) */}
      <figure
        className="rounded-xl border p-5 shadow-sm space-y-3"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5" style={{ borderColor: "var(--border)" }}>
          <figcaption className="text-sm font-semibold">
            Saídas e Devoluções (últimos 14 dias)
          </figcaption>
          <div className="flex items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: "var(--brand)" }} />
              Saídas
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: "var(--ok)" }} />
              Devoluções
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <svg
            role="img"
            aria-label="Gráfico de saídas e devoluções nos últimos 14 dias"
            viewBox="0 0 700 200"
            className="w-full min-w-[540px] h-48"
          >
            <title>Saídas e Devoluções nos últimos 14 dias</title>
            {[0.25, 0.5, 0.75, 1].map((step) => {
              const y = 165 - step * 135;
              return (
                <line
                  key={step}
                  x1="30"
                  x2="690"
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity="0.12"
                />
              );
            })}
            <line x1="30" x2="690" y1="165" y2="165" stroke="currentColor" strokeOpacity="0.25" />

            {timelineDays.map((day, i) => {
              const groupX = 40 + i * 46;
              const outH = Math.round((day.out / maxDaily) * 135);
              const retH = Math.round((day.returned / maxDaily) * 135);
              return (
                <g key={day.key}>
                  <rect
                    x={groupX}
                    y={165 - outH}
                    width="14"
                    height={outH}
                    rx="3"
                    fill="var(--brand)"
                  >
                    <title>{`${day.label}: ${day.out} saídas`}</title>
                  </rect>
                  <rect
                    x={groupX + 16}
                    y={165 - retH}
                    width="14"
                    height={retH}
                    rx="3"
                    fill="var(--ok)"
                  >
                    <title>{`${day.label}: ${day.returned} devoluções`}</title>
                  </rect>
                  <text
                    x={groupX + 15}
                    y="185"
                    textAnchor="middle"
                    fontSize="11"
                    fill="currentColor"
                    opacity="0.7"
                  >
                    {day.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer font-medium" style={{ color: "var(--text-muted)" }}>
            Tabela de dados (últimos 14 dias)
          </summary>
          <div className="table-wrapper mt-2">
            <table className="w-full text-xs border-collapse">
              <caption className="sr-only">Saídas e devoluções por dia</caption>
              <thead>
                <tr className="border-b text-left" style={{ borderColor: "var(--border)" }}>
                  <th scope="col" className="py-1.5 pr-3">Data</th>
                  <th scope="col" className="py-1.5 pr-3">Saídas</th>
                  <th scope="col" className="py-1.5">Devoluções</th>
                </tr>
              </thead>
              <tbody>
                {timelineDays.map((d) => (
                  <tr key={d.key} className="border-b" style={{ borderColor: "var(--border)" }}>
                    <td className="py-1 pr-3">{d.label}</td>
                    <td className="py-1 pr-3">{d.out}</td>
                    <td className="py-1">{d.returned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </figure>

      {/* Grid of Breakdown Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Donut Chart: Equipment Ownership */}
        <figure
          className="rounded-xl border p-5 shadow-sm space-y-4"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <figcaption className="text-sm font-semibold border-b pb-2.5" style={{ borderColor: "var(--border)" }}>
            Origem / Posse dos Equipamentos
          </figcaption>

          {ownershipTotal === 0 ? (
            <p className="text-xs py-4" style={{ color: "var(--text-muted)" }}>
              Nenhum equipamento cadastrado.
            </p>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-5">
              <svg
                role="img"
                aria-label="Distribuição por posse dos equipamentos"
                viewBox="0 0 120 120"
                className="w-28 h-28 shrink-0 -rotate-90"
              >
                <title>Distribuição por posse dos equipamentos</title>
                <circle
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke="var(--surface-alt)"
                  strokeWidth="16"
                />
                {donutSegments.map(
                  (seg) =>
                    seg.count > 0 && (
                      <circle
                        key={seg.key}
                        cx="60"
                        cy="60"
                        r={radius}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="16"
                        strokeDasharray={seg.dashArray}
                        strokeDashoffset={seg.dashOffset}
                      />
                    )
                )}
              </svg>

              <ul className="space-y-2 text-xs flex-1 w-full">
                {ownershipCounts.map((o) => {
                  const pct = Math.round((o.count / ownershipTotal) * 100);
                  return (
                    <li key={o.key} className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: o.color }}
                        />
                        <span className="truncate">{o.label}</span>
                      </span>
                      <strong className="font-mono shrink-0">
                        {o.count} ({pct}%)
                      </strong>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </figure>

        <HorizontalBarCard
          title="Equipamentos por Situação"
          rows={conditionRows}
          emptyText="Nenhum equipamento cadastrado."
        />

        <HorizontalBarCard
          title="Situação das Movimentações"
          rows={statusBreakdownRows}
          emptyText="Nenhuma movimentação no período."
        />

        <HorizontalBarCard
          title="Setores com Mais Movimentações"
          rows={sectorRows}
          emptyText="Nenhuma movimentação no período."
        />

        <HorizontalBarCard
          title="Locais Mais Movimentados"
          rows={locationRows}
          emptyText="Nenhum local movimentado no período."
          barColor="#0284c7"
        />

        <HorizontalBarCard
          title="Equipamentos Mais Movimentados"
          rows={topEquipmentRows}
          emptyText="Nenhuma movimentação no período."
          barColor="var(--warn)"
        />

        <HorizontalBarCard
          title="Registros e Devoluções por Técnico"
          rows={technicianRows}
          emptyText="Sem registros no período."
          barColor="var(--ok)"
        />
      </div>
    </div>
  );
}
