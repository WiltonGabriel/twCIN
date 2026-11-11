import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "../services/api";
import type { AuditLogItem, TiUser } from "../types";
import { formatDateTime } from "../types/labels";
import { OnlineOnlyNotice } from "./OnlineOnlyNotice";

const ENTITY_LABELS: Record<string, string> = {
  movement: "Movimentação",
  catalog_equipment: "Equipamento",
  catalog_sector: "Setor",
  catalog_location: "Local",
  user: "Usuário",
  auth: "Acesso",
  app_settings: "Configurações",
  system: "Sistema"
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Criação",
  UPDATE: "Edição",
  STATUS_CHANGE: "Mudança de situação",
  RETURN: "Devolução",
  RETURN_TO_OWNER: "Devolução ao dono",
  LOGIN: "Login",
  LOGIN_FAILED: "Login recusado",
  LOGOUT: "Logout",
  PASSWORD_CHANGE: "Troca de senha",
  SESSION_REVOKED: "Sessões encerradas",
  SYNC_CONFLICT: "Conflito de sincronização",
  BACKUP: "Backup",
  RESTORE: "Restauração de backup"
};

interface Filters {
  q: string;
  entity: string;
  action: string;
  user_id: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { q: "", entity: "", action: "", user_id: "", from: "", to: "" };

/** Trilha de auditoria completa, com filtros e paginação (antes só os últimos 250 por tela). */
export function AuditPanel({ users, online }: { users: TiUser[]; online: boolean }) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async (f: Filters, before: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      (Object.keys(f) as Array<keyof Filters>).forEach((k) => {
        if (f[k].trim()) params.set(k, f[k].trim());
      });
      if (before) params.set("before_id", String(before));
      const res = await apiRequest<{ items: AuditLogItem[]; next_before_id: number | null }>(`/api/audit?${params}`);
      setItems((prev) => (before ? [...prev, ...res.items] : res.items));
      setCursor(res.next_before_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a auditoria (é preciso estar online).");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(applied, null);
  }, [applied, load]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setApplied({ ...filters });
  };

  const set = (key: keyof Filters, value: string) => setFilters({ ...filters, [key]: value });

  return (
    <div className="space-y-4">
      {!online && <OnlineOnlyNotice text="Você está offline. Consultar a trilha de auditoria exige conexão." />}
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="sm:col-span-2 lg:col-span-3 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} aria-hidden="true" />
          <input type="search" aria-label="Buscar na auditoria" value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Buscar no resumo ou nome de quem fez" className="tw-input" style={{ paddingLeft: "2.25rem" }} />
        </div>
        <select aria-label="Tipo de registro" value={filters.entity} onChange={(e) => set("entity", e.target.value)} className="tw-input">
          <option value="">Todos os tipos</option>
          {Object.entries(ENTITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Ação" value={filters.action} onChange={(e) => set("action", e.target.value)} className="tw-input">
          <option value="">Todas as ações</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Pessoa" value={filters.user_id} onChange={(e) => set("user_id", e.target.value)} className="tw-input">
          <option value="">Todas as pessoas</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <div>
          <label htmlFor="audit-from" className="tw-label">De</label>
          <input id="audit-from" type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} className="tw-input" />
        </div>
        <div>
          <label htmlFor="audit-to" className="tw-label">Até</label>
          <input id="audit-to" type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} className="tw-input" />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" disabled={!online} className="tw-btn tw-btn-primary">Filtrar</button>
          <button type="button" className="tw-btn" onClick={() => { setFilters(EMPTY); setApplied(EMPTY); }}>Limpar</button>
        </div>
      </form>

      {error && <p className="text-sm" style={{ color: "var(--warn)" }}>{error}</p>}

      <ul className="space-y-2">
        {items.map((log) => {
          const open = expanded === log.id;
          const hasDetails = Boolean(log.before_json || log.after_json);
          return (
            <li key={log.id} className="tw-card p-3 text-sm" style={{ backgroundColor: "var(--bg)" }}>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="tw-badge" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand)" }}>{ACTION_LABELS[log.action] ?? log.action}</span>
                    <span style={{ color: "var(--text-muted)" }}>{ENTITY_LABELS[log.entity] ?? log.entity}</span>
                    <strong>{log.user_name}</strong>
                  </div>
                  <p>{log.summary}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
                  {formatDateTime(log.created_at)}
                  {hasDetails && (
                    <button type="button" className="tw-btn tw-btn-sm" aria-expanded={open} onClick={() => setExpanded(open ? null : log.id)}>
                      {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />} Detalhes
                    </button>
                  )}
                </div>
              </div>
              {open && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                  {(["before_json", "after_json"] as const).map((key) =>
                    log[key] ? (
                      <div key={key}>
                        <div className="text-xs font-semibold mb-1">{key === "before_json" ? "Antes" : "Depois"}</div>
                        <pre className="text-xs p-2 rounded overflow-auto max-h-64" style={{ backgroundColor: "var(--surface-alt)" }}>
                          {JSON.stringify(JSON.parse(log[key] as string), null, 2)}
                        </pre>
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!loading && items.length === 0 && !error && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Nenhum registro encontrado.</p>
      )}
      {loading && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Carregando...</p>}
      {cursor && !loading && (
        <button type="button" className="tw-btn" onClick={() => void load(applied, cursor)}>Carregar mais</button>
      )}
    </div>
  );
}
