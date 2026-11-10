import { Database, FileSpreadsheet } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError } from "../services/api";
import type { CatalogEquipment, MovementItem } from "../types";
import { CONDITION_LABELS, OWNERSHIP_LABELS, movementStatusLabel } from "../types/labels";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Evita que planilhas executem fórmulas vindas de campos de texto (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(header: string[], rows: unknown[][]): string {
  // BOM para o Excel abrir com acentuação correta; ";" é o separador padrão do Excel em pt-BR.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}

const stamp = () => new Date().toISOString().slice(0, 10);

interface ExportPanelProps {
  equipments: CatalogEquipment[];
  movements: MovementItem[];
}

export function ExportPanel({ equipments, movements }: ExportPanelProps) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const exportEquipments = () => {
    const csv = toCsv(
      ["Nome", "Patrimônio", "Categoria", "Posse", "Situação", "Ativo", "Recebido de", "Origem", "Motivo", "Observações", "Cadastrado em"],
      equipments.map((e) => [
        e.name,
        e.patrimony,
        e.category,
        OWNERSHIP_LABELS[e.ownership_type],
        CONDITION_LABELS[e.condition_status],
        e.active ? "Sim" : "Não",
        e.received_from,
        e.origin,
        e.reason,
        e.notes,
        e.created_at
      ])
    );
    downloadBlob(csv, `equipamentos-${stamp()}.csv`, "text/csv;charset=utf-8");
  };

  const exportMovements = () => {
    const csv = toCsv(
      ["Código", "Tipo", "Equipamento", "Patrimônio", "Setor", "Local", "Recebido por", "Saída", "Prazo", "Situação", "Devolução", "Registrado por", "Recebido de volta por", "Observações"],
      movements.map((m) => [
        m.document_code,
        m.movement_type === "emprestimo" ? "Empréstimo" : "Instalação fixa",
        m.equipment_name,
        m.patrimony,
        m.sector_name,
        m.install_location,
        m.received_by,
        m.out_at,
        m.due_at ?? "",
        movementStatusLabel(m),
        m.returned_at ?? "",
        m.registered_by_name,
        m.returned_to_name ?? "",
        m.notes
      ])
    );
    downloadBlob(csv, `movimentacoes-${stamp()}.csv`, "text/csv;charset=utf-8");
  };

  const downloadBackup = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/backup", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(data?.error || `Erro HTTP ${res.status}`, res.status);
      }
      downloadBlob(await res.arrayBuffer(), `twcin-backup-${stamp()}.db`, "application/vnd.sqlite3");
      setPassword("");
      setMessage({ ok: true, text: "Backup baixado. Guarde o arquivo em local seguro: ele contém todos os dados do sistema." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Não foi possível gerar o backup (é preciso estar online)." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Exportar planilhas (CSV)</h3>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Gera arquivos que abrem no Excel ou no Google Planilhas, com os dados que estão neste aparelho.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="tw-btn" onClick={exportEquipments}>
            <FileSpreadsheet className="w-4 h-4" aria-hidden="true" /> Equipamentos ({equipments.length})
          </button>
          <button type="button" className="tw-btn" onClick={exportMovements}>
            <FileSpreadsheet className="w-4 h-4" aria-hidden="true" /> Movimentações ({movements.length})
          </button>
        </div>
      </section>

      <section className="space-y-3 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-sm font-semibold">Backup do banco de dados</h3>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Baixa uma cópia completa do banco (inclusive usuários e auditoria). Por segurança, confirme sua senha.
        </p>
        <form onSubmit={downloadBackup} className="flex flex-col sm:flex-row gap-2 max-w-lg">
          <input type="password" aria-label="Sua senha" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Sua senha" className="tw-input" />
          <button type="submit" className="tw-btn tw-btn-primary shrink-0" disabled={busy}>
            <Database className="w-4 h-4" aria-hidden="true" /> {busy ? "Gerando..." : "Baixar backup"}
          </button>
        </form>
        {message && (
          <p role={message.ok ? "status" : "alert"} className="text-sm" style={{ color: message.ok ? "var(--ok)" : "var(--cin-red)" }}>
            {message.text}
          </p>
        )}
      </section>
    </div>
  );
}
