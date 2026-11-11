import { Lock, LogOut } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError } from "../services/api";
import type { AuthUser, PublicSettings } from "../types";

interface ForcePasswordChangePageProps {
  user: AuthUser;
  settings: PublicSettings;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<AuthUser>;
  onLogout: () => void;
}

export function ForcePasswordChangePage({
  user,
  settings,
  onChangePassword,
  onLogout
}: ForcePasswordChangePageProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("A nova senha deve ter no mínimo 8 caracteres.");
      return;
    }

    if (newPassword === currentPassword) {
      setError("A nova senha deve ser diferente da senha atual.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("A confirmação da nova senha não confere.");
      return;
    }

    setSubmitting(true);
    try {
      await onChangePassword(currentPassword, newPassword);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Não foi possível alterar a senha.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div
        className="w-full max-w-md rounded-xl border p-6 sm:p-8 shadow-sm space-y-5"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)"
        }}
      >
        <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-lg px-2 py-1 border border-slate-200 shrink-0">
              <img src={settings.logo_data_url || "/logo.svg"} alt={settings.app_name} className="h-7 w-auto block" />
            </div>
            <div>
              <h1 className="text-base font-bold">Definir nova senha</h1>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {user.full_name} (@{user.username})
              </p>
            </div>
          </div>

          <button type="button" onClick={onLogout} className="tw-btn tw-btn-sm">
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            Sair
          </button>
        </div>

        <p id="fp-hint" className="text-xs flex items-start gap-2" style={{ color: "var(--text-muted)" }}>
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            No primeiro acesso é obrigatório escolher uma nova senha pessoal (mín. 8 caracteres). As senhas são armazenadas
            de forma criptografada e não podem ser exibidas.
          </span>
        </p>

        <form method="POST" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="fp-current" className="tw-label">
              Senha atual <span aria-hidden="true">*</span>
            </label>
            <input
              id="fp-current"
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                if (error) setError(null);
              }}
              className="tw-input"
            />
          </div>

          <div>
            <label htmlFor="fp-new" className="tw-label">
              Nova senha <span aria-hidden="true">*</span>
            </label>
            <input
              id="fp-new"
              name="new_password"
              type="password"
              aria-describedby="fp-hint"
              autoComplete="new-password"
              minLength={8}
              required
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                if (error) setError(null);
              }}
              className="tw-input"
            />
          </div>

          <div>
            <label htmlFor="fp-confirm" className="tw-label">
              Confirmar nova senha <span aria-hidden="true">*</span>
            </label>
            <input
              id="fp-confirm"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (error) setError(null);
              }}
              className="tw-input"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="px-3 py-2.5 rounded-lg text-sm border"
              style={{
                backgroundColor: "var(--cin-red-soft)",
                borderColor: "var(--cin-red)",
                color: "var(--cin-red)"
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full tw-btn tw-btn-primary min-h-[46px]"
          >
            {submitting ? "Salvando..." : "Salvar nova senha e entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
