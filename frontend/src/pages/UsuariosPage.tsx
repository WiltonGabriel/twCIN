import { KeyRound, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { OnlineOnlyNotice } from "../components/OnlineOnlyNotice";
import { apiRequest } from "../services/api";
import type { AuthUser, TiUser, UserRole } from "../types";

interface UsuariosPageProps {
  users: TiUser[];
  currentUser: AuthUser;
  online: boolean;
  onRefresh: () => Promise<void>;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Nunca acessou";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR");
}

export function UsuariosPage({ users, currentUser, online, onRefresh }: UsuariosPageProps) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("tecnico");
  const [mustChangeOnFirst, setMustChangeOnFirst] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<
    (TiUser & { newPassword: string; mustChange: boolean; nextRole: UserRole }) | null
  >(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (editing && !d.open) d.showModal();
    else if (!editing && d.open) d.close();
  }, [editing]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onClose = () => {
      d.returnValue = "";
      setEditing(null);
    };
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, []);

  const filteredUsers = users.filter((u) => {
    if (statusFilter === "active" && u.active !== 1) return false;
    if (statusFilter === "inactive" && u.active !== 0) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.full_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
  });

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await apiRequest("/api/users", {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName,
          username,
          password,
          role,
          must_change_password: mustChangeOnFirst
        })
      });
      setFullName("");
      setUsername("");
      setPassword("");
      setRole("tecnico");
      setMustChangeOnFirst(true);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao cadastrar usuário.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (u: TiUser) => {
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: u.active !== 1 })
      });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao alterar status.");
    }
  };

  const handleRevokeSessions = async (u: TiUser) => {
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/users/${u.id}/revoke-sessions`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setNotice(`Sessões encerradas para ${u.full_name}.`);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao encerrar sessões.");
    }
  };

  const handleEditSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await apiRequest(`/api/users/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          full_name: editing.full_name,
          username: editing.username,
          role: editing.nextRole,
          must_change_password: editing.mustChange,
          ...(editing.newPassword ? { password: editing.newPassword } : {})
        })
      });
      setEditing(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar usuário.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {!online && <OnlineOnlyNotice text="Você está offline. Cadastrar ou alterar usuários exige conexão." />}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <section
          className="xl:col-span-5 rounded-xl border p-5 shadow-sm space-y-4"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-base font-semibold">Novo Usuário</h2>
          </div>

        <form onSubmit={handleCreate} className="space-y-3">
          <div>
            <label htmlFor="u-fullname" className="block text-xs font-medium mb-1">
              Nome completo <span aria-hidden="true">*</span>
            </label>
            <input
              id="u-fullname"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="tw-input"
            />
          </div>
          <div>
            <label htmlFor="u-username" className="block text-xs font-medium mb-1">
              Usuário (login) <span aria-hidden="true">*</span>
            </label>
            <input
              id="u-username"
              required
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="tw-input"
            />
          </div>
          <div>
            <label htmlFor="u-password" className="block text-xs font-medium mb-1">
              Senha inicial <span aria-hidden="true">*</span>
            </label>
            <input
              id="u-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="tw-input"
            />
          </div>
          <div>
            <label htmlFor="u-role" className="block text-xs font-medium mb-1">
              Perfil
            </label>
            <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="tw-input">
              <option value="tecnico">Técnico (operações do dia a dia)</option>
              <option value="admin">Administrador (equipe, regras e backup)</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={mustChangeOnFirst}
              onChange={(e) => setMustChangeOnFirst(e.target.checked)}
            />
            <span>Exigir nova senha no primeiro login</span>
          </label>

          {error && (
            <div
              role="alert"
              className="px-3 py-2 rounded-lg text-sm border"
              style={{
                backgroundColor: "var(--cin-red-soft)",
                borderColor: "var(--cin-red)",
                color: "var(--cin-red)"
              }}
            >
              {error}
            </div>
          )}

          {notice && (
            <div
              role="status"
              className="px-3 py-2 rounded-lg text-sm border"
              style={{
                backgroundColor: "var(--ok-soft)",
                borderColor: "var(--ok)",
                color: "var(--ok)"
              }}
            >
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={!online || saving}
            className="w-full min-h-[44px] rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-60"
            style={{ backgroundColor: "var(--brand)", color: "var(--brand-fg)" }}
          >
            Cadastrar
          </button>
        </form>
      </section>

      <section
        className="xl:col-span-7 rounded-xl border p-5 shadow-sm space-y-4"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-base font-semibold">Usuários ({users.length})</h2>
          <search className="flex flex-wrap gap-2">
            <input
              type="search"
              aria-label="Filtrar usuários"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nome ou login..."
              className="tw-input sm:w-48"
            />
            <select
              aria-label="Filtrar situação"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
              className="tw-input sm:w-32"
            >
              <option value="all">Todos</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
          </search>
        </div>

        <div className="space-y-2.5">
          {filteredUsers.map((u) => (
            <div
              key={u.id}
              className="p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <strong className="text-sm">{u.full_name}</strong>
                  <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                    @{u.username}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-medium"
                    style={
                      u.role === "tecnico"
                        ? { backgroundColor: "var(--surface-alt)", color: "var(--text-muted)" }
                        : { backgroundColor: "var(--brand-soft)", color: "var(--brand)" }
                    }
                  >
                    {u.role === "tecnico" ? "Técnico" : "Admin"}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-medium"
                    style={
                      u.active === 1
                        ? { backgroundColor: "var(--ok-soft)", color: "var(--ok)" }
                        : { backgroundColor: "var(--cin-red-soft)", color: "var(--cin-red)" }
                    }
                  >
                    {u.active === 1 ? "Ativo" : "Inativo"}
                  </span>
                  {u.must_change_password === 1 && (
                    <span
                      className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{ backgroundColor: "var(--warn-soft)", color: "var(--warn)" }}
                    >
                      Troca de senha pendente
                    </span>
                  )}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Último acesso: {formatDateTime(u.last_login_at)}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={!online}
                  onClick={() =>
                    setEditing({
                      ...u,
                      newPassword: "",
                      mustChange: u.must_change_password === 1,
                      nextRole: u.role === "tecnico" ? "tecnico" : "admin"
                    })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border cursor-pointer disabled:opacity-50"
                  style={{ borderColor: "var(--border)" }}
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  Editar
                </button>
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => void handleRevokeSessions(u)}
                  title="Encerra sessões ativas em outros dispositivos"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border cursor-pointer disabled:opacity-50"
                  style={{ borderColor: "var(--border)" }}
                >
                  <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                  Encerrar sessões
                </button>
                {u.id !== currentUser.id && (
                  <button
                    type="button"
                    disabled={!online}
                    onClick={() => void handleToggleActive(u)}
                    className="px-2.5 py-1.5 rounded-lg text-xs border cursor-pointer disabled:opacity-50"
                    style={{ borderColor: "var(--border)" }}
                  >
                    {u.active === 1 ? "Desativar" : "Ativar"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <dialog ref={dialogRef} aria-labelledby="edit-user-title" className="m-auto w-[min(94vw,440px)] rounded-xl p-5 shadow-xl">
        {editing && (
          <form onSubmit={handleEditSave} className="space-y-3">
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--border)" }}>
              <h3 id="edit-user-title" className="text-sm font-semibold">Editar Usuário</h3>
              <button type="button" aria-label="Fechar" onClick={() => setEditing(null)} className="p-1 rounded border cursor-pointer" style={{ borderColor: "var(--border)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Nome completo</label>
              <input required value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} className="tw-input" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Usuário (login)</label>
              <input required value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} className="tw-input" />
            </div>
            <div>
              <label htmlFor="edit-u-role" className="block text-xs font-medium mb-1">Perfil</label>
              <select
                id="edit-u-role"
                value={editing.nextRole}
                disabled={editing.id === currentUser.id}
                onChange={(e) => setEditing({ ...editing, nextRole: e.target.value as UserRole })}
                className="tw-input"
              >
                <option value="tecnico">Técnico</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Nova senha (opcional)</label>
              <input type="password" minLength={8} autoComplete="new-password" value={editing.newPassword} onChange={(e) => setEditing({ ...editing, newPassword: e.target.value })} className="tw-input" />
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={editing.mustChange}
                onChange={(e) => setEditing({ ...editing, mustChange: e.target.checked })}
              />
              <span>Exigir nova senha no próximo login</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg text-xs border cursor-pointer" style={{ borderColor: "var(--border)" }}>Cancelar</button>
              <button type="submit" disabled={saving} className="px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer" style={{ backgroundColor: "var(--brand)", color: "var(--brand-fg)" }}>Salvar</button>
            </div>
          </form>
        )}
      </dialog>
      </div>
    </div>
  );
}
