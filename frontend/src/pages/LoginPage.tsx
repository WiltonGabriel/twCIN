import { Database, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, readFileAsBase64 } from "../services/api";
import type { PublicSettings } from "../types";

interface LoginPageProps {
  needsSetup: boolean;
  settings: PublicSettings;
  onLogin: (username: string, password: string) => Promise<unknown>;
  onSetupInitial: (payload: {
    full_name: string;
    username: string;
    password: string;
    app_name?: string;
    org_name?: string;
  }) => Promise<unknown>;
  onRestoreInitial: (backupBase64: string) => Promise<{
    restored_users: number;
    restored_equipments: number;
    restored_movements: number;
  }>;
}

export function LoginPage({
  needsSetup,
  settings,
  onLogin,
  onSetupInitial,
  onRestoreInitial
}: LoginPageProps) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState(settings.org_name || "Setor de TI");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreMode, setRestoreMode] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setRestoreNotice(null);
    setSubmitting(true);
    try {
      if (needsSetup) {
        if (password.length < 8) {
          setError("A senha inicial deve ter no mínimo 8 caracteres.");
          setSubmitting(false);
          return;
        }
        await onSetupInitial({
          full_name: fullName.trim(),
          username: username.trim(),
          password,
          org_name: orgName.trim() || undefined
        });
      } else {
        await onLogin(username.trim(), password);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Não foi possível conectar ao servidor.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestoreInitial = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setRestoreNotice(null);
    if (!restoreFile) {
      setError("Selecione o arquivo .db de backup.");
      return;
    }
    if (restoreFile.size > 35 * 1024 * 1024) {
      setError("O arquivo excede o tamanho máximo suportado (35 MB).");
      return;
    }
    setSubmitting(true);
    try {
      const base64 = await readFileAsBase64(restoreFile);
      const res = await onRestoreInitial(base64);
      setRestoreMode(false);
      setRestoreFile(null);
      setRestoreNotice(
        `Backup importado (${res.restored_equipments} equipamento(s), ${res.restored_movements} movimentação(ões)). Entre com uma conta existente do backup.`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível importar o backup.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div
        className="w-full max-w-md rounded-xl border p-6 sm:p-8 shadow-sm space-y-6"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)"
        }}
      >
        <div className="flex items-center gap-3.5 border-b pb-5" style={{ borderColor: "var(--border)" }}>
          <div className="bg-white rounded-lg px-2.5 py-1.5 border border-slate-200 shrink-0">
            <img
              src={settings.logo_data_url || "/logo.svg"}
              alt={settings.app_name}
              className="h-9 w-auto block"
            />
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              {settings.org_name}
              {settings.org_subtitle ? ` · ${settings.org_subtitle}` : ""}
            </p>
            <h1 className="text-xl font-bold tracking-tight">
              {needsSetup ? `${settings.app_name} — Configuração Inicial` : settings.app_name}
            </h1>
          </div>
        </div>

        {restoreNotice && (
          <div
            role="status"
            className="px-3 py-2.5 rounded-lg text-sm border"
            style={{ backgroundColor: "var(--ok-soft)", borderColor: "var(--ok)", color: "var(--ok)" }}
          >
            {restoreNotice}
          </div>
        )}

        {needsSetup && restoreMode ? (
          <form method="POST" onSubmit={handleRestoreInitial} className="space-y-4">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Importe um arquivo <code className="font-mono">.db</code> exportado de outra instalação do twCIN para
              restaurar equipamentos, movimentações, setores, aparência e contas.
            </p>
            <div className="space-y-2">
              <label
                className="w-full min-h-[48px] px-4 py-2.5 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 cursor-pointer"
                style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
              >
                <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{restoreFile ? restoreFile.name : "Selecionar arquivo de backup (.db)"}</span>
                <input
                  type="file"
                  accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3"
                  onChange={(e) => {
                    setError(null);
                    setRestoreFile(e.target.files?.[0] ?? null);
                  }}
                  className="sr-only"
                />
              </label>
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
              disabled={submitting || !restoreFile}
              className="w-full tw-btn tw-btn-primary min-h-[46px]"
            >
              {submitting ? "Importando backup..." : "Importar backup e restaurar"}
            </button>
          </form>
        ) : (
        <form method="POST" onSubmit={handleSubmit} className="space-y-4">
          {needsSetup && (
            <>
              <div className="space-y-1.5">
                <label htmlFor="setup-org" className="block text-sm font-medium">
                  Nome da organização / setor
                </label>
                <input
                  id="setup-org"
                  name="org_name"
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="tw-input"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="setup-fullname" className="block text-sm font-medium">
                  Seu nome completo <span aria-hidden="true">*</span>
                </label>
                <input
                  id="setup-fullname"
                  name="full_name"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="tw-input"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <label htmlFor="login-username" className="block text-sm font-medium">
              Usuário <span aria-hidden="true">*</span>
            </label>
            <input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              required
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) setError(null);
              }}
              className="tw-input"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="login-password" className="block text-sm font-medium">
              {needsSetup ? "Senha (mín. 8 caracteres)" : "Senha"} <span aria-hidden="true">*</span>
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete={needsSetup ? "new-password" : "current-password"}
              enterKeyHint="done"
              minLength={needsSetup ? 8 : 1}
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
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
            className="w-full min-h-[46px] rounded-lg text-sm font-semibold transition cursor-pointer disabled:opacity-60"
            style={{
              backgroundColor: "var(--brand)",
              color: "var(--brand-fg)"
            }}
          >
            {submitting
              ? needsSetup
                ? "Criando acesso..."
                : "Entrando..."
              : needsSetup
                ? "Criar primeiro usuário"
                : "Entrar"}
          </button>
        </form>
        )}

        {needsSetup && (
          <div className="pt-3 border-t text-center" style={{ borderColor: "var(--border)" }}>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setRestoreMode((v) => !v);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer underline"
              style={{ color: "var(--brand)" }}
            >
              <Database className="w-3.5 h-3.5" aria-hidden="true" />
              {restoreMode ? "Voltar e criar um sistema do zero" : "Já tem um backup? Importar arquivo .db"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
