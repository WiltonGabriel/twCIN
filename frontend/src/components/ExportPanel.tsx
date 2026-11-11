import { Database, FileSpreadsheet, Upload } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest, ApiError, readFileAsBase64 } from "../services/api";
import type { CatalogEquipment, MovementItem } from "../types";
import { CONDITION_LABELS, OWNERSHIP_LABELS, movementStatusLabel } from "../types/labels";
import { OnlineOnlyNotice } from "./OnlineOnlyNotice";

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
  return "\ufeff" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}

const stamp = () => new Date().toISOString().slice(0, 10);

interface ExportPanelProps {
  equipments: CatalogEquipment[];
  movements: MovementItem[];
  online: boolean;
  canBackup: boolean;
  onBackupRestored: () => Promise<void>;
}

export function ExportPanel({ equipments, movements, online, canBackup, onBackupRestored }: ExportPanelProps) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!dialog) return;
    if (confirmOpen && !dialog.open) dialog.showModal();
    else if (!confirmOpen && dialog.open) dialog.close();
  }, [confirmOpen]);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      dialog.returnValue = "";
      setConfirmOpen(false);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

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
      setMessage({ ok: true, text: "Backup exportado. Guarde o arquivo .db em local seguro: ele contém todos os dados do sistema." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Não foi possível exportar o backup (é preciso estar online)." });
    } finally {
      setBusy(false);
    }
  };

  const requestRestore = (e: FormEvent) => {
    e.preventDefault();
    setRestoreMessage(null);
    if (!restoreFile) {
      setRestoreMessage({ ok: false, text: "Selecione um arquivo .db de backup." });
      return;
    }
    if (restoreFile.size > 35 * 1024 * 1024) {
      setRestoreMessage({ ok: false, text: "O arquivo excede o tamanho máximo suportado (35 MB)." });
      return;
    }
    setConfirmOpen(true);
  };

  const confirmRestore = async () => {
    if (!restoreFile) return;
    setRestoring(true);
    setRestoreMessage(null);
    try {
      const backup_base64 = await readFileAsBase64(restoreFile);
      const res = await apiRequest<{
        restored_users: number;
        restored_equipments: number;
        restored_movements: number;
      }>("/api/backup/restore", {
        method: "POST",
        body: JSON.stringify({ password: restorePassword, backup_base64 })
      });
      setConfirmOpen(false);
      setRestorePassword("");
      setRestoreFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await onBackupRestored();
      setRestoreMessage({
        ok: true,
        text: `Backup importado: ${res.restored_equipments} equipamento(s), ${res.restored_movements} movimentação(ões) e ${res.restored_users} usuário(s).`
      });
    } catch (err) {
      setConfirmOpen(false);
      setRestoreMessage({
        ok: false,
        text: err instanceof Error ? err.message : "Não foi possível importar o backup."
      });
    } finally {
      setRestoring(false);
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

      {canBackup && (
        <>
          <section className="space-y-3 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-sm font-semibold">Exportar backup completo (.db)</h3>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Baixa uma cópia integral do sistema (equipamentos, movimentações, setores, locais, usuários, aparência e auditoria).
              Serve tanto para recuperação quanto para migrar tudo para outra instalação.
            </p>
            {!online && <OnlineOnlyNotice text="Você está offline. Exportar ou importar o backup completo exige conexão." />}
            <form onSubmit={downloadBackup} className="flex flex-col sm:flex-row gap-2 max-w-lg">
              <input
                type="password"
                aria-label="Sua senha para exportar backup"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Sua senha"
                className="tw-input"
              />
              <button type="submit" className="tw-btn tw-btn-primary shrink-0" disabled={!online || busy}>
                <Database className="w-4 h-4" aria-hidden="true" /> {busy ? "Exportando..." : "Exportar backup"}
              </button>
            </form>
            {message && (
              <p role={message.ok ? "status" : "alert"} className="text-sm" style={{ color: message.ok ? "var(--ok)" : "var(--cin-red)" }}>
                {message.text}
              </p>
            )}
          </section>

          <section className="space-y-3 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-sm font-semibold">Importar backup (.db)</h3>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Restaura os dados completos a partir de um arquivo <code className="font-mono text-xs">.db</code> exportado do twCIN.
              Atenção: todos os dados atuais desta instalação serão substituídos pelos do backup.
            </p>
            <form onSubmit={requestRestore} className="space-y-3 max-w-lg">
              <div className="flex flex-wrap items-center gap-3">
                <label
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 rounded-lg text-xs font-medium border cursor-pointer"
                  style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{restoreFile ? restoreFile.name : "Escolher arquivo .db"}</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3"
                    onChange={(e) => {
                      setRestoreMessage(null);
                      setRestoreFile(e.target.files?.[0] ?? null);
                    }}
                    className="sr-only"
                  />
                </label>
                {restoreFile && (
                  <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                    {Math.max(1, Math.round(restoreFile.size / 1024))} KB
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  aria-label="Sua senha para importar backup"
                  autoComplete="current-password"
                  required
                  value={restorePassword}
                  onChange={(e) => setRestorePassword(e.target.value)}
                  placeholder="Sua senha atual"
                  className="tw-input"
                />
                <button type="submit" className="tw-btn tw-btn-danger shrink-0" disabled={!online || restoring || !restoreFile}>
                  <Upload className="w-4 h-4" aria-hidden="true" /> Importar backup
                </button>
              </div>
            </form>
            {restoreMessage && (
              <p role={restoreMessage.ok ? "status" : "alert"} className="text-sm" style={{ color: restoreMessage.ok ? "var(--ok)" : "var(--cin-red)" }}>
                {restoreMessage.text}
              </p>
            )}
          </section>
        </>
      )}

      <dialog ref={confirmDialogRef} aria-labelledby="restore-confirm-title" className="m-auto w-[min(94vw,460px)] rounded-xl p-5 shadow-xl">
        <div className="space-y-4">
          <h2 id="restore-confirm-title" className="text-base font-semibold">
            Restaurar backup agora?
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            O arquivo <strong>{restoreFile?.name}</strong> substituirá todos os equipamentos, movimentações, configurações,
            aparência e contas atuais. Recomendamos exportar um backup atual antes de continuar.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" autoFocus className="tw-btn" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </button>
            <button type="button" disabled={restoring} className="tw-btn tw-btn-danger" onClick={() => void confirmRestore()}>
              {restoring ? "Restaurando..." : "Sim, importar backup"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
