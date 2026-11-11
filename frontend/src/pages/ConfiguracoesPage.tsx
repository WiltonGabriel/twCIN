import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  Crop,
  Download,
  FileDown,
  Info,
  ListChecks,
  Lock,
  LogOut,
  MapPin,
  Monitor,
  Moon,
  Paintbrush,
  Palette,
  RefreshCw,
  Smartphone,
  Sun,
  Upload,
  UserCircle2,
  Users
} from "lucide-react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { AppearancePanel } from "../components/AppearancePanel";
import { AuditPanel } from "../components/AuditPanel";
import { CadastrosPanel } from "../components/CadastrosPanel";
import { ExportPanel } from "../components/ExportPanel";
import { ImageEditorModal } from "../components/ImageEditorModal";
import { OnlineOnlyNotice } from "../components/OnlineOnlyNotice";
import { PageIntro } from "../components/PageIntro";
import { SobrePanel } from "../components/SobrePanel";
import { SyncPanel } from "../components/SyncPanel";
import type { PwaInstallState } from "../hooks/usePwaInstall";
import type { FailedOpEntry } from "../offline/db";
import { apiRequest, ApiError } from "../services/api";
import { downloadDataUrl } from "../utils/imageEditor";
import type {
  AuthUser,
  CatalogCategory,
  CatalogEquipment,
  CatalogLocation,
  CatalogSector,
  MovementItem,
  PublicSettings,
  SuggestionsPayload,
  ThemePreference,
  TiUser
} from "../types";
import { UsuariosPage } from "./UsuariosPage";

export type SettingsTab =
  | "conta"
  | "preferencias"
  | "organizacao"
  | "aparencia"
  | "cadastros"
  | "regras"
  | "equipe"
  | "sincronizacao"
  | "auditoria"
  | "exportar"
  | "aplicativo"
  | "sobre";

interface ConfiguracoesPageProps {
  user: AuthUser;
  settings: PublicSettings;
  preference: ThemePreference;
  systemTheme: "light" | "dark";
  pwa: PwaInstallState;
  initialTab?: SettingsTab;
  users: TiUser[];
  equipments: CatalogEquipment[];
  movements: MovementItem[];
  sectors: CatalogSector[];
  categories: CatalogCategory[];
  locations: CatalogLocation[];
  suggestions: SuggestionsPayload;
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  failedOps: FailedOpEntry[];
  onSyncNow: () => void;
  onRetryFailed: (id: number, overwrite: boolean) => Promise<void>;
  onDiscardFailed: (id: number) => Promise<void>;
  onCreateSector: (payload: { name: string; is_default?: boolean }) => Promise<CatalogSector>;
  onCreateCategory: (payload: { name: string; is_default?: boolean }) => Promise<CatalogCategory>;
  onRefresh: () => Promise<void>;
  onChangeTheme: (pref: ThemePreference) => void;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<AuthUser>;
  onSettingsUpdated: (settings: PublicSettings) => void;
  onPreviewAppearance: (draft: PublicSettings | null) => void;
  onBackupRestored: () => Promise<void>;
  onLogoutAll: () => Promise<void>;
}

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ id: SettingsTab; label: string; hint: string; icon: typeof UserCircle2 }>;
}> = [
  {
    label: "Pessoal",
    items: [
      { id: "conta", label: "Minha conta", hint: "Perfil, senha e sessões", icon: UserCircle2 },
      { id: "preferencias", label: "Preferências", hint: "Tema claro ou escuro", icon: Palette }
    ]
  },
  {
    label: "Sistema",
    items: [
      { id: "organizacao", label: "Organização", hint: "Nome, unidade, contato e logo", icon: Building2 },
      { id: "aparencia", label: "Aparência", hint: "Paleta de cores e fundo", icon: Paintbrush },
      { id: "cadastros", label: "Cadastros", hint: "Setores, categorias e locais", icon: MapPin },
      { id: "regras", label: "Regras de empréstimo", hint: "Prazo padrão", icon: CalendarClock },
      { id: "equipe", label: "Equipe", hint: "Usuários e acessos", icon: Users }
    ]
  },
  {
    label: "Dados",
    items: [
      { id: "sincronizacao", label: "Sincronização", hint: "Pendências offline", icon: RefreshCw },
      { id: "auditoria", label: "Auditoria", hint: "Quem fez o quê", icon: ListChecks },
      { id: "exportar", label: "Exportar e backup", hint: "CSV e cópia do banco", icon: FileDown },
      { id: "aplicativo", label: "Aplicativo", hint: "Instalar no dispositivo", icon: Smartphone },
      { id: "sobre", label: "Sobre", hint: "Versão e informações", icon: Info }
    ]
  }
];

const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items);
const ADMIN_TABS = new Set<SettingsTab>(["organizacao", "aparencia", "regras", "equipe"]);

export function ConfiguracoesPage({
  user,
  settings,
  preference,
  systemTheme,
  pwa,
  initialTab,
  users,
  equipments,
  movements,
  sectors,
  categories,
  locations,
  suggestions,
  online,
  syncing,
  pendingCount,
  failedOps,
  onSyncNow,
  onRetryFailed,
  onDiscardFailed,
  onCreateSector,
  onCreateCategory,
  onRefresh,
  onChangeTheme,
  onChangePassword,
  onSettingsUpdated,
  onPreviewAppearance,
  onBackupRestored,
  onLogoutAll
}: ConfiguracoesPageProps) {
  const isAdmin = user.role !== "tecnico";
  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: isAdmin ? g.items : g.items.filter((item) => !ADMIN_TABS.has(item.id))
  }));
  const initialAllowed = initialTab && (isAdmin || !ADMIN_TABS.has(initialTab)) ? initialTab : undefined;
  const [subTab, setSubTab] = useState<SettingsTab>(initialAllowed ?? "conta");
  /** No celular, o menu e a seção ocupam a tela inteira, um de cada vez. */
  const [mobileShowSection, setMobileShowSection] = useState(Boolean(initialAllowed));
  const [installFeedback, setInstallFeedback] = useState<string | null>(null);

  const [loanDays, setLoanDays] = useState(String(settings.loan_default_days ?? 7));
  const [rulesMessage, setRulesMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [logoutAllBusy, setLogoutAllBusy] = useState(false);

  const current = ALL_NAV.find((n) => n.id === subTab)!;

  const selectTab = (id: SettingsTab) => {
    setSubTab(id);
    setMobileShowSection(true);
  };

  const handleRulesSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setRulesMessage(null);
    const days = Number(loanDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      setRulesMessage({ ok: false, text: "Informe um número de dias entre 0 e 365." });
      return;
    }
    setRulesSaving(true);
    try {
      const res = await apiRequest<{ settings: PublicSettings }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ loan_default_days: days })
      });
      onSettingsUpdated(res.settings);
      setRulesMessage({ ok: true, text: "Regra salva. Vale para os próximos empréstimos." });
    } catch (err) {
      setRulesMessage({ ok: false, text: err instanceof Error ? err.message : "Erro ao salvar." });
    } finally {
      setRulesSaving(false);
    }
  };

  const handleLogoutAll = async () => {
    if (!window.confirm("Encerrar sua sessão em todos os dispositivos, inclusive neste?")) return;
    setLogoutAllBusy(true);
    try {
      await onLogoutAll();
    } finally {
      setLogoutAllBusy(false);
    }
  };

  const [appName, setAppName] = useState(settings.app_name);
  const [orgName, setOrgName] = useState(settings.org_name);
  const [orgSubtitle, setOrgSubtitle] = useState(settings.org_subtitle ?? "");
  const [orgDocument, setOrgDocument] = useState(settings.org_document ?? "");
  const [orgContact, setOrgContact] = useState(settings.org_contact ?? "");
  const [loanTermFooter, setLoanTermFooter] = useState(settings.loan_term_footer ?? "");
  const [logoDataUrl, setLogoDataUrl] = useState(settings.logo_data_url);
  const [logoEditorSource, setLogoEditorSource] = useState<File | string | null>(null);

  useEffect(() => {
    setLoanDays(String(settings.loan_default_days ?? 7));
    setAppName(settings.app_name);
    setOrgName(settings.org_name);
    setOrgSubtitle(settings.org_subtitle ?? "");
    setOrgDocument(settings.org_document ?? "");
    setOrgContact(settings.org_contact ?? "");
    setLoanTermFooter(settings.loan_term_footer ?? "");
    setLogoDataUrl(settings.logo_data_url);
  }, [settings]);
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgMessage, setOrgMessage] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const themeOptions: Array<{
    value: ThemePreference;
    label: string;
    detail: string;
    icon: typeof Monitor;
  }> = [
    {
      value: "system",
      label: "Padrão do sistema",
      detail: `Segue o dispositivo (atual: ${systemTheme === "dark" ? "Escuro" : "Claro"})`,
      icon: Monitor
    },
    {
      value: "light",
      label: "Claro",
      detail: "Fundo claro de alto contraste",
      icon: Sun
    },
    {
      value: "dark",
      label: "Escuro",
      detail: "Superfícies escuras para menor fadiga visual",
      icon: Moon
    }
  ];

  const handleLogoFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setOrgError(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setLogoEditorSource(file);
  };

  const handleOrgSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setOrgError(null);
    setOrgMessage(null);
    setOrgSaving(true);
    try {
      const res = await apiRequest<{ settings: PublicSettings }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          app_name: appName.trim(),
          org_name: orgName.trim(),
          org_subtitle: orgSubtitle.trim(),
          org_document: orgDocument.trim(),
          org_contact: orgContact.trim(),
          loan_term_footer: loanTermFooter.trim(),
          logo_data_url: logoDataUrl
        })
      });
      onSettingsUpdated(res.settings);
      setOrgMessage("Identidade da organização atualizada.");
    } catch (err) {
      setOrgError(err instanceof ApiError ? err.message : "Erro ao salvar configurações.");
    } finally {
      setOrgSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

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

    setSaving(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Senha atualizada com sucesso.");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Não foi possível alterar a senha.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleInstallClick = async () => {
    setInstallFeedback(null);
    const outcome = await pwa.triggerInstall();
    if (outcome === "accepted") {
      setInstallFeedback("Instalação iniciada no dispositivo.");
    } else if (outcome === "dismissed") {
      setInstallFeedback("Instalação cancelada. Você pode tentar novamente quando quiser.");
    } else {
      setInstallFeedback("O navegador não disponibilizou o prompt automático neste momento.");
    }
  };

  const initials = user.full_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");

  return (
    <div className="space-y-5">
      <PageIntro
        title="Configurações"
        purpose="Sua conta e preferências, os cadastros e regras do sistema, a equipe e os dados (sincronização, auditoria, exportação e backup)."
        howTo={[
          "Pessoal: sua senha, as sessões abertas e o tema da interface.",
          "Sistema: organização, setores e locais, prazo padrão de empréstimo e a equipe de TI.",
          "Dados: pendências offline, a auditoria completa, exportação em planilha e backup."
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <nav
          aria-label="Seções de configurações"
          className={`lg:col-span-3 tw-card p-2.5 space-y-3 ${mobileShowSection ? "hidden lg:block" : ""}`}
        >
          {visibleGroups.map((group) => (
            <div key={group.label} className="space-y-1">
              <div className="px-3 pt-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                {group.label}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = subTab === item.id;
                const badge = item.id === "sincronizacao" && failedOps.length > 0 ? failedOps.length : null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => selectTab(item.id)}
                    className="w-full min-h-[48px] px-3 py-2 rounded-lg text-left flex items-center gap-3 border cursor-pointer"
                    style={
                      active
                        ? { backgroundColor: "var(--brand-soft)", borderColor: "var(--brand)", color: "var(--brand)" }
                        : { backgroundColor: "transparent", borderColor: "transparent", color: "var(--text)" }
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-tight">{item.label}</span>
                      <span className="block text-xs truncate" style={{ color: active ? "var(--brand)" : "var(--text-muted)" }}>
                        {item.hint}
                      </span>
                    </span>
                    {badge && (
                      <span className="tw-badge" style={{ backgroundColor: "var(--warn-soft)", color: "var(--warn)" }}>{badge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <section className={`lg:col-span-9 tw-card p-5 sm:p-6 ${mobileShowSection ? "" : "hidden lg:block"}`}>
          <div key={subTab} className="tw-page-enter space-y-6">
          <button type="button" className="tw-btn tw-btn-sm lg:hidden" onClick={() => setMobileShowSection(false)}>
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Configurações
          </button>

          {subTab !== "conta" && subTab !== "organizacao" && subTab !== "preferencias" && subTab !== "aplicativo" && (
            <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-base font-semibold">{current.label}</h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {subTab === "aparencia" && "Paleta de cores da organização e imagem de fundo aplicadas em todo o sistema."}
                {subTab === "cadastros" && "Setores de destino, categorias de equipamentos e locais de instalação."}
                {subTab === "regras" && "Regras aplicadas automaticamente nas novas movimentações."}
                {subTab === "equipe" && "Contas da equipe de TI. Administradores gerenciam equipe, organização, regras e backup."}
                {subTab === "sincronizacao" && "O que foi feito sem internet e ainda não chegou ao servidor, ou que o servidor recusou."}
                {subTab === "auditoria" && "Registro de tudo o que foi feito no sistema, por quem e quando."}
                {subTab === "exportar" && "Planilhas para análise e cópia de segurança do banco de dados."}
                {subTab === "sobre" && "Versão, informações da organização e resumo do dispositivo."}
              </p>
            </div>
          )}

          {subTab === "aparencia" && isAdmin && (
            <AppearancePanel
              settings={settings}
              online={online}
              onPreviewChange={onPreviewAppearance}
              onSaved={onSettingsUpdated}
            />
          )}

          {subTab === "cadastros" && (
            <CadastrosPanel
              sectors={sectors}
              categories={categories}
              locations={locations}
              suggestions={suggestions}
              online={online}
              onCreateSector={onCreateSector}
              onCreateCategory={onCreateCategory}
              onRefresh={onRefresh}
            />
          )}

          {subTab === "regras" && isAdmin && (
            <form onSubmit={handleRulesSubmit} className="space-y-4 max-w-xl">
              {!online && <OnlineOnlyNotice />}
              <div>
                <label htmlFor="rule-days" className="tw-label">Prazo padrão de devolução dos empréstimos (dias)</label>
                <input id="rule-days" type="number" min={0} max={365} required value={loanDays} onChange={(e) => setLoanDays(e.target.value)} className="tw-input" style={{ maxWidth: "10rem" }} />
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  Sugerido ao registrar cada empréstimo e pode ser alterado na hora. Use 0 para não sugerir prazo. Empréstimos
                  com prazo vencido aparecem como atrasados no Início.
                </p>
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Regras fixas: equipamentos em manutenção, avaliação, descartados ou devolvidos ao dono não podem sair, e um equipamento
                não pode estar em duas movimentações ao mesmo tempo.
              </p>
              {rulesMessage && (
                <p role={rulesMessage.ok ? "status" : "alert"} className="text-sm" style={{ color: rulesMessage.ok ? "var(--ok)" : "var(--cin-red)" }}>
                  {rulesMessage.text}
                </p>
              )}
              <button type="submit" className="tw-btn tw-btn-primary" disabled={!online || rulesSaving}>{rulesSaving ? "Salvando..." : "Salvar regra"}</button>
            </form>
          )}

          {subTab === "equipe" && isAdmin && <UsuariosPage users={users} currentUser={user} online={online} onRefresh={onRefresh} />}

          {subTab === "sincronizacao" && (
            <SyncPanel
              online={online}
              syncing={syncing}
              pendingCount={pendingCount}
              failedOps={failedOps}
              onSyncNow={onSyncNow}
              onRetry={onRetryFailed}
              onDiscard={onDiscardFailed}
            />
          )}

          {subTab === "auditoria" && <AuditPanel users={users} online={online} />}

          {subTab === "exportar" && (
            <ExportPanel
              equipments={equipments}
              movements={movements}
              online={online}
              canBackup={isAdmin}
              onBackupRestored={onBackupRestored}
            />
          )}

          {subTab === "sobre" && (
            <SobrePanel
              user={user}
              settings={settings}
              online={online}
              counts={{
                equipments: equipments.length,
                movements: movements.length,
                sectors: sectors.length,
                locations: locations.length
              }}
            />
          )}
          {subTab === "conta" && (
            <div className="space-y-6">
              <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <h2 className="text-base font-semibold">Minha conta</h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Informações do seu usuário autenticado e atualização de senha.
                </p>
              </div>

              <div
                className="p-4 rounded-xl border flex flex-wrap items-center justify-between gap-4"
                style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                    style={{ backgroundColor: "var(--brand)", color: "var(--brand-fg)" }}
                    aria-hidden="true"
                  >
                    {initials || "TI"}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{user.full_name}</div>
                    <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                      @{user.username}
                    </div>
                  </div>
                </div>
                {user.last_login_at && (
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Último acesso:{" "}
                    <strong>{new Date(user.last_login_at).toLocaleString("pt-BR")}</strong>
                  </div>
                )}
              </div>

              <form onSubmit={handlePasswordSubmit} className="tw-card p-4 sm:p-5 space-y-4 max-w-xl" style={{ backgroundColor: "var(--bg)" }}>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Alterar senha</h3>
                  <p id="cfg-pass-hint" className="text-xs flex items-start gap-1.5" style={{ color: "var(--text-muted)" }}>
                    <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      Mínimo de 8 caracteres. Sua senha é protegida por criptografia irreversível e nunca fica visível.
                    </span>
                  </p>
                </div>
                {!online && <OnlineOnlyNotice text="Você está offline. Alterar senha ou encerrar sessões exige conexão." />}

                <div>
                  <label htmlFor="cfg-cur-pass" className="tw-label">
                    Senha atual <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="cfg-cur-pass"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value);
                      if (error) setError(null);
                      if (success) setSuccess(null);
                    }}
                    className="tw-input"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="cfg-new-pass" className="tw-label">
                      Nova senha <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="cfg-new-pass"
                      type="password"
                      aria-describedby="cfg-pass-hint"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        if (error) setError(null);
                        if (success) setSuccess(null);
                      }}
                      className="tw-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="cfg-confirm-pass" className="tw-label">
                      Confirmar nova senha <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="cfg-confirm-pass"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (error) setError(null);
                        if (success) setSuccess(null);
                      }}
                      className="tw-input"
                    />
                  </div>
                </div>

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

                {success && (
                  <div
                    role="status"
                    className="px-3 py-2 rounded-lg text-sm border"
                    style={{
                      backgroundColor: "var(--ok-soft)",
                      borderColor: "var(--ok)",
                      color: "var(--ok)"
                    }}
                  >
                    {success}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!online || saving}
                  className="tw-btn tw-btn-primary"
                >
                  {saving ? "Salvando..." : "Atualizar senha"}
                </button>
              </form>

              <section className="pt-5 border-t space-y-2 max-w-xl" style={{ borderColor: "var(--border)" }}>
                <h3 className="text-sm font-semibold">Sessões</h3>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Se você esqueceu o sistema aberto em outro computador ou celular, encerre todas as sessões. Você precisará
                  entrar de novo em todos os dispositivos, inclusive neste.
                </p>
                <button type="button" className="tw-btn tw-btn-danger" disabled={!online || logoutAllBusy} onClick={() => void handleLogoutAll()}>
                  <LogOut className="w-4 h-4" aria-hidden="true" /> Sair de todos os dispositivos
                </button>
              </section>
            </div>
          )}

          {subTab === "organizacao" && isAdmin && (
            <div className="space-y-6">
              <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <h2 className="text-base font-semibold">Organização</h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Identificação exibida na barra superior, tela de login e relatórios em PDF.
                </p>
              </div>
              {!online && <OnlineOnlyNotice />}

              <form onSubmit={handleOrgSubmit} className="space-y-5 max-w-2xl">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="org-appname" className="tw-label">
                      Nome do sistema
                    </label>
                    <input
                      id="org-appname"
                      required
                      value={appName}
                      onChange={(e) => setAppName(e.target.value)}
                      className="tw-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="org-name" className="tw-label">
                      Nome da organização / setor
                    </label>
                    <input
                      id="org-name"
                      required
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="tw-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="org-subtitle" className="tw-label">
                      Unidade / departamento (opcional)
                    </label>
                    <input
                      id="org-subtitle"
                      value={orgSubtitle}
                      onChange={(e) => setOrgSubtitle(e.target.value)}
                      placeholder="Ex.: Campus Recife · Bloco B"
                      className="tw-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="org-doc" className="tw-label">
                      CNPJ ou código institucional (opcional)
                    </label>
                    <input
                      id="org-doc"
                      value={orgDocument}
                      onChange={(e) => setOrgDocument(e.target.value)}
                      placeholder="Ex.: 00.000.000/0001-00"
                      className="tw-input"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="org-contact" className="tw-label">
                      Contato / suporte do TI (opcional)
                    </label>
                    <input
                      id="org-contact"
                      value={orgContact}
                      onChange={(e) => setOrgContact(e.target.value)}
                      placeholder="Ex.: suporte@empresa.com · Ramal 4100"
                      className="tw-input"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="org-term" className="tw-label">
                      Observação extra nos termos em PDF (opcional)
                    </label>
                    <textarea
                      id="org-term"
                      value={loanTermFooter}
                      onChange={(e) => setLoanTermFooter(e.target.value)}
                      placeholder="Ex.: Devolver na sala da TI B-12 de segunda a sexta, das 8h às 17h."
                      className="tw-textarea"
                    />
                  </div>
                </div>

                <div
                  className="p-4 rounded-xl border space-y-3"
                  style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
                >
                  <div>
                    <span className="block text-xs font-semibold">Logotipo personalizado (também usado como favicon na guia)</span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Exibido no cabeçalho, na aba do navegador, no login e nos PDFs. Aceita qualquer imagem compatível e converte para WebP/PNG após o recorte.
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="bg-white rounded-lg p-2.5 border border-slate-200">
                      <img
                        src={logoDataUrl || "/logo.svg"}
                        alt={appName}
                        className="h-10 w-auto block"
                      />
                    </div>
                    <label
                      className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 rounded-lg text-xs font-medium border cursor-pointer"
                      style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Enviar e recortar</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoFileChange}
                        className="sr-only"
                      />
                    </label>
                    {logoDataUrl && (
                      <>
                        <button
                          type="button"
                          onClick={() => setLogoEditorSource(logoDataUrl)}
                          className="tw-btn"
                        >
                          <Crop className="w-3.5 h-3.5" aria-hidden="true" />
                          Editar / recortar
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadDataUrl(logoDataUrl, "logo-organizacao")}
                          className="tw-btn"
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          Baixar
                        </button>
                        <button
                          type="button"
                          onClick={() => setLogoDataUrl("")}
                          className="tw-btn tw-btn-danger"
                        >
                          Remover logo
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {orgError && (
                  <div
                    role="alert"
                    className="px-3 py-2 rounded-lg text-sm border"
                    style={{
                      backgroundColor: "var(--cin-red-soft)",
                      borderColor: "var(--cin-red)",
                      color: "var(--cin-red)"
                    }}
                  >
                    {orgError}
                  </div>
                )}

                {orgMessage && (
                  <div
                    role="status"
                    className="px-3 py-2 rounded-lg text-sm border"
                    style={{
                      backgroundColor: "var(--ok-soft)",
                      borderColor: "var(--ok)",
                      color: "var(--ok)"
                    }}
                  >
                    {orgMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!online || orgSaving}
                  className="min-h-[44px] px-5 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-60"
                  style={{ backgroundColor: "var(--brand)", color: "var(--brand-fg)" }}
                >
                  {orgSaving ? "Salvando..." : "Salvar organização"}
                </button>
              </form>
            </div>
          )}

          {subTab === "preferencias" && (
            <div className="space-y-6">
              <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <h2 className="text-base font-semibold">Preferências</h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Preferência de cores salva localmente para este navegador.
                </p>
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold mb-2">Tema da interface</legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {themeOptions.map((opt) => {
                    const Icon = opt.icon;
                    const checked = preference === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className="p-4 rounded-xl border flex flex-col gap-3 cursor-pointer transition"
                        style={{
                          backgroundColor: checked ? "var(--brand-soft)" : "var(--bg)",
                          borderColor: checked ? "var(--brand)" : "var(--border)"
                        }}
                      >
                        <div
                          className="h-14 rounded-lg border overflow-hidden grid grid-cols-2"
                          style={{ borderColor: "var(--border)" }}
                          aria-hidden="true"
                        >
                          <div
                            className="p-2 flex flex-col justify-between"
                            style={{
                              backgroundColor:
                                opt.value === "dark" ? "#090e1a" : "#f4f6fa"
                            }}
                          >
                            <span
                              className="h-2 w-8 rounded"
                              style={{
                                backgroundColor: opt.value === "dark" ? "#4f8df5" : "#002d6b"
                              }}
                            />
                            <span
                              className="h-2 w-10 rounded"
                              style={{
                                backgroundColor: opt.value === "dark" ? "#1e293b" : "#d6deeb"
                              }}
                            />
                          </div>
                          <div
                            className="p-2 flex flex-col justify-between"
                            style={{
                              backgroundColor:
                                opt.value === "light" ? "#ffffff" : "#101829"
                            }}
                          >
                            <span
                              className="h-2 w-6 rounded self-end"
                              style={{
                                backgroundColor: opt.value === "light" ? "#c81018" : "#f25f66"
                              }}
                            />
                            <span
                              className="h-2 w-9 rounded"
                              style={{
                                backgroundColor: opt.value === "light" ? "#cbd5e1" : "#263554"
                              }}
                            />
                          </div>
                        </div>

                        <div className="flex items-start gap-2.5">
                          <input
                            type="radio"
                            name="theme-preference"
                            value={opt.value}
                            checked={checked}
                            onChange={() => onChangeTheme(opt.value)}
                            className="mt-1"
                          />
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-1.5 text-sm font-semibold">
                              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                              <span>{opt.label}</span>
                            </div>
                            <span className="block text-xs leading-snug" style={{ color: "var(--text-muted)" }}>
                              {opt.detail}
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          )}

          {subTab === "aplicativo" && (
            <div className="space-y-6">
              <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <h2 className="text-base font-semibold">Aplicativo (PWA e Offline)</h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Instale o {appName} na tela inicial do celular ou na área de trabalho sem janelas automáticas.
                </p>
              </div>

              <div
                className="p-5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {pwa.isInstalled ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" style={{ color: "var(--ok)" }} aria-hidden="true" />
                        <span>Aplicativo instalado neste dispositivo</span>
                      </>
                    ) : (
                      <>
                        <Smartphone className="w-4 h-4" style={{ color: "var(--brand)" }} aria-hidden="true" />
                        <span>Instalar {appName} no dispositivo</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs max-w-xl" style={{ color: "var(--text-muted)" }}>
                    {pwa.isInstalled
                      ? "Você já está executando o sistema em modo aplicativo independente (standalone)."
                      : pwa.canInstall
                        ? "Pronto para instalar com suporte a funcionamento offline e sincronização automática."
                        : !pwa.isSecureContext
                          ? "A instalação direta no celular exige conexão segura via HTTPS (ou localhost no computador). Ao acessar por IP HTTP na rede local, o navegador bloqueia o instalador automático."
                          : pwa.isIos
                            ? "No Safari (iPhone/iPad), toque no botão Compartilhar e escolha 'Adicionar à Tela de Início'."
                            : "Se o botão não estiver ativo, utilize o menu do navegador (⋮ → Instalar aplicativo / Adicionar à tela inicial)."}
                  </p>
                </div>

                {!pwa.isInstalled && (
                  <button
                    type="button"
                    disabled={!pwa.canInstall}
                    onClick={handleInstallClick}
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg text-sm font-semibold shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: "var(--brand)", color: "var(--brand-fg)" }}
                  >
                    <Download className="w-4 h-4" aria-hidden="true" />
                    <span>Instalar no dispositivo</span>
                  </button>
                )}
              </div>

              {installFeedback && (
                <div
                  role="status"
                  className="px-3.5 py-2.5 rounded-lg text-sm border"
                  style={{ backgroundColor: "var(--brand-soft)", borderColor: "var(--brand)", color: "var(--brand)" }}
                >
                  {installFeedback}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3.5 rounded-xl border space-y-1" style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}>
                  <div className="font-semibold">Contexto seguro</div>
                  <div style={{ color: pwa.isSecureContext ? "var(--ok)" : "var(--warn)" }}>
                    {pwa.isSecureContext ? "HTTPS / Localhost ativo" : "HTTP local (sem HTTPS)"}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl border space-y-1" style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}>
                  <div className="font-semibold">Service Worker</div>
                  <div style={{ color: pwa.swActive ? "var(--ok)" : pwa.hasServiceWorkerSupport ? "var(--text-muted)" : "var(--warn)" }}>
                    {pwa.swActive
                      ? "Ativo (cache offline pronto)"
                      : pwa.hasServiceWorkerSupport
                        ? "Disponível após carregamento completo"
                        : "Indisponível sem HTTPS"}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl border space-y-1" style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}>
                  <div className="font-semibold">Armazenamento offline</div>
                  <div style={{ color: "var(--ok)" }}>IndexedDB (Dexie) habilitado</div>
                </div>
              </div>
            </div>
          )}
          </div>
        </section>
      </div>

      <ImageEditorModal
        source={logoEditorSource}
        mode="logo"
        maxDimension={512}
        maxDataUrlLength={740_000}
        defaultFilename="logo-organizacao"
        onCancel={() => setLogoEditorSource(null)}
        onApply={(dataUrl) => {
          setLogoDataUrl(dataUrl);
          setLogoEditorSource(null);
        }}
      />
    </div>
  );
}
