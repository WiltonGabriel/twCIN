import { ArrowLeftRight, Home, LogOut, Monitor, RefreshCw, Settings, Wifi, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import type { AuthUser, PageKey, PublicSettings } from "../types";

interface AppShellProps {
  user: AuthUser;
  settings: PublicSettings;
  activePage: PageKey;
  onNavigate: (page: PageKey) => void;
  onLogout: () => void;
  online: boolean;
  pendingCount: number;
  failedCount: number;
  syncing: boolean;
  syncNotice: string | null;
  onClearSyncNotice: () => void;
  onSyncNow: () => void;
  onOpenSync: () => void;
  children: ReactNode;
}

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: typeof Home }> = [
  { key: "inicio", label: "Início", icon: Home },
  { key: "equipamentos", label: "Equipamentos", icon: Monitor },
  { key: "movimentacoes", label: "Movimentações", icon: ArrowLeftRight },
  { key: "configuracoes", label: "Configurações", icon: Settings }
];

export function AppShell({
  user,
  settings,
  activePage,
  onNavigate,
  onLogout,
  online,
  pendingCount,
  failedCount,
  syncing,
  syncNotice,
  onClearSyncNotice,
  onSyncNow,
  onOpenSync,
  children
}: AppShellProps) {
  const syncLabel = !online
    ? pendingCount > 0
      ? `Offline (${pendingCount} pendente${pendingCount > 1 ? "s" : ""})`
      : "Offline"
    : syncing
      ? "Sincronizando..."
      : pendingCount > 0
        ? `Enviando (${pendingCount})`
        : failedCount > 0
          ? `${failedCount} com problema`
          : "Online";

  const syncColor = !online ? "var(--cin-red)" : pendingCount > 0 || failedCount > 0 ? "var(--warn)" : "var(--ok)";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="no-print sticky top-0 z-30 border-b" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-white rounded-md px-2 py-1 border border-slate-200 shrink-0">
              <img src={settings.logo_data_url || "/logo.svg"} alt="" className="h-6 w-auto block" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight truncate">{settings.app_name}</div>
              <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{settings.org_name}</div>
            </div>
          </div>

          <nav aria-label="Navegação principal" className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = activePage === item.key;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onNavigate(item.key)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer"
                  style={active ? { backgroundColor: "var(--brand)", color: "var(--brand-fg)" } : { color: "var(--text-muted)" }}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={failedCount > 0 ? onOpenSync : onSyncNow}
              title={failedCount > 0 ? "Ver alterações com problema" : online ? "Sincronizar agora" : "Sem conexão"}
              aria-label={`Sincronização: ${syncLabel}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-alt)", color: syncColor }}
            >
              {!online ? (
                <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
              ) : syncing ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{syncLabel}</span>
            </button>

            <span className="hidden lg:inline text-sm font-medium px-1">{user.full_name}</span>

            <button
              type="button"
              onClick={onLogout}
              aria-label="Sair"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer"
              style={{ borderColor: "var(--border)" }}
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      {syncNotice && (
        <div role="status" className="no-print max-w-7xl w-full mx-auto px-4 pt-3">
          <div className="px-4 py-2.5 rounded-lg border text-sm flex flex-wrap items-center justify-between gap-3" style={{ backgroundColor: "var(--warn-soft)", borderColor: "var(--warn)", color: "var(--warn)" }}>
            <span>{syncNotice}</span>
            <span className="flex gap-3">
              <button type="button" onClick={() => { onClearSyncNotice(); onOpenSync(); }} className="text-xs font-semibold underline cursor-pointer">
                Revisar
              </button>
              <button type="button" onClick={onClearSyncNotice} className="text-xs font-semibold underline cursor-pointer">
                Fechar
              </button>
            </span>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-5 pb-24 md:pb-8">{children}</main>

      {/* Barra inferior no celular: os 4 destinos principais sempre à mão. */}
      <nav
        aria-label="Navegação principal (celular)"
        className="no-print md:hidden fixed bottom-0 inset-x-0 z-30 border-t grid grid-cols-4"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV_ITEMS.map((item) => {
          const active = activePage === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(item.key)}
              className="flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium cursor-pointer"
              style={{ color: active ? "var(--brand)" : "var(--text-muted)" }}
            >
              <Icon className="w-5 h-5" aria-hidden="true" />
              {item.label === "Movimentações" ? "Movimentar" : item.label === "Configurações" ? "Ajustes" : item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
