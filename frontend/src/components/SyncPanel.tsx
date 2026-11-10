import { AlertTriangle, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { FailedOpEntry } from "../offline/db";

const OPERATION_LABELS: Record<FailedOpEntry["type"], string> = {
  "equipment.create": "Cadastro de equipamento",
  "equipment.update": "Edição de equipamento",
  "equipment.return_to_owner": "Devolução ao dono",
  "movement.create": "Registro de movimentação",
  "movement.update": "Edição de movimentação",
  "movement.return": "Devolução",
  "sector.create": "Cadastro de setor"
};

function describe(op: FailedOpEntry): string {
  const record = op.optimistic?.record as
    | { name?: string; equipment_name?: string; document_code?: string }
    | undefined;
  const payload = op.payload as { name?: string; equipment_name?: string };
  const target =
    record?.document_code && record.document_code !== "PENDENTE"
      ? `${record.document_code} — ${record.equipment_name ?? ""}`
      : record?.equipment_name || record?.name || payload.equipment_name || payload.name || "";
  return target ? `${OPERATION_LABELS[op.type]}: ${target}` : OPERATION_LABELS[op.type];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR");
}

interface SyncPanelProps {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  failedOps: FailedOpEntry[];
  onSyncNow: () => void;
  onRetry: (id: number, overwrite: boolean) => Promise<void>;
  onDiscard: (id: number) => Promise<void>;
}

export function SyncPanel({
  online,
  syncing,
  pendingCount,
  failedOps,
  onSyncNow,
  onRetry,
  onDiscard
}: SyncPanelProps) {
  const [busyId, setBusyId] = useState<number | null>(null);

  const run = async (id: number, action: () => Promise<void>) => {
    setBusyId(id);
    try {
      await action();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="tw-stat">
          <span className="tw-stat-label">Conexão</span>
          <strong style={{ color: online ? "var(--ok)" : "var(--cin-red)" }}>{online ? "Online" : "Offline"}</strong>
        </div>
        <div className="tw-stat">
          <span className="tw-stat-label">Aguardando envio</span>
          <strong>{pendingCount}</strong>
        </div>
        <div className="tw-stat">
          <span className="tw-stat-label">Com problema</span>
          <strong style={{ color: failedOps.length > 0 ? "var(--warn)" : undefined }}>{failedOps.length}</strong>
        </div>
      </div>

      <button type="button" className="tw-btn" onClick={onSyncNow} disabled={!online || syncing}>
        <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
        {syncing ? "Sincronizando..." : "Sincronizar agora"}
      </button>

      <section className="space-y-3" aria-labelledby="failed-ops-title">
        <h3 id="failed-ops-title" className="text-sm font-semibold">
          Alterações que não puderam ser aplicadas
        </h3>
        {failedOps.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nenhuma pendência. Tudo o que foi feito offline chegou ao servidor.
          </p>
        ) : (
          <ul className="space-y-2">
            {failedOps.map((op) => (
              <li key={op.id} className="tw-card p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--warn)" }} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{describe(op)}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Feita em {formatDate(op.created_at)} · {op.status === "conflict" ? "Conflito" : "Erro"}: {op.error}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {op.status === "conflict" && (
                    <button
                      type="button"
                      className="tw-btn tw-btn-sm"
                      disabled={busyId === op.id}
                      onClick={() => void run(op.id!, () => onRetry(op.id!, true))}
                      title="Aplica a sua alteração por cima da versão atual do servidor"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      Aplicar mesmo assim
                    </button>
                  )}
                  {op.status === "error" && (
                    <button
                      type="button"
                      className="tw-btn tw-btn-sm"
                      disabled={busyId === op.id}
                      onClick={() => void run(op.id!, () => onRetry(op.id!, false))}
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      Tentar de novo
                    </button>
                  )}
                  <button
                    type="button"
                    className="tw-btn tw-btn-sm tw-btn-danger"
                    disabled={busyId === op.id}
                    onClick={() => {
                      if (window.confirm("Descartar esta alteração? Ela não será enviada ao servidor.")) {
                        void run(op.id!, () => onDiscard(op.id!));
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Descartar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
