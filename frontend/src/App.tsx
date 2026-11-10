import { useState } from "react";
import { AppShell } from "./components/AppShell";
import { AuditDrawer } from "./components/AuditDrawer";
import { PdfModal, type PdfPayload } from "./components/PdfModal";
import { useAuth } from "./hooks/useAuth";
import { usePwaInstall } from "./hooks/usePwaInstall";
import { useSyncData } from "./hooks/useSyncData";
import { useTheme } from "./hooks/useTheme";
import { getPendingSyncCount } from "./offline/syncEngine";
import { apiRequest } from "./services/api";
import { ConfiguracoesPage, type SettingsTab } from "./pages/ConfiguracoesPage";
import { EquipamentosPage } from "./pages/EquipamentosPage";
import { ForcePasswordChangePage } from "./pages/ForcePasswordChangePage";
import { InicioPage } from "./pages/InicioPage";
import { LoginPage } from "./pages/LoginPage";
import { MovimentacoesPage } from "./pages/MovimentacoesPage";
import type { PageKey } from "./types";

export function App() {
  const {
    user,
    needsSetup,
    settings,
    setSettings,
    loading,
    setupInitial,
    login,
    changePassword,
    logout,
    setUser
  } = useAuth();
  const { preference, systemTheme, setPreference } = useTheme();
  const pwa = usePwaInstall();
  const [activePage, setActivePage] = useState<PageKey>("inicio");
  // Seção inicial de Configurações + chave para remontar quando abrimos uma seção específica.
  const [settingsTarget, setSettingsTarget] = useState<{ tab: SettingsTab | undefined; key: number }>({
    tab: undefined,
    key: 0
  });
  const [pdfPayload, setPdfPayload] = useState<PdfPayload | null>(null);
  const [auditTarget, setAuditTarget] = useState<{
    entity: string;
    entityId: number;
    title: string;
  } | null>(null);

  const readyUser = user && !user.must_change_password ? user : null;
  const syncData = useSyncData(readyUser, () => setUser(null), setSettings);

  const navigate = (page: PageKey) => {
    if (page === "configuracoes") setSettingsTarget((s) => ({ tab: undefined, key: s.key + 1 }));
    setActivePage(page);
  };

  const openSettings = (tab: SettingsTab) => {
    setSettingsTarget((s) => ({ tab, key: s.key + 1 }));
    setActivePage("configuracoes");
  };

  const handleLogout = async () => {
    if (user) {
      const pending = await getPendingSyncCount(user.id);
      if (
        pending > 0 &&
        !window.confirm(
          `Há ${pending} alteração(ões) feita(s) offline que ainda não chegaram ao servidor. ` +
            "Se você sair agora, elas serão perdidas. Deseja sair mesmo assim?"
        )
      ) {
        return;
      }
    }
    await logout();
  };

  const handleLogoutAll = async () => {
    await apiRequest("/api/auth/logout-all", { method: "POST", body: JSON.stringify({}) });
    await logout();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>
        Carregando...
      </div>
    );
  }

  if (!user) {
    return <LoginPage needsSetup={needsSetup} settings={settings} onLogin={login} onSetupInitial={setupInitial} />;
  }

  if (user.must_change_password) {
    return (
      <ForcePasswordChangePage
        user={user}
        settings={settings}
        onChangePassword={changePassword}
        onLogout={() => void handleLogout()}
      />
    );
  }

  return (
    <AppShell
      user={user}
      settings={settings}
      activePage={activePage}
      onNavigate={navigate}
      onLogout={() => void handleLogout()}
      online={syncData.online}
      pendingCount={syncData.pendingCount}
      failedCount={syncData.failedOps.length}
      syncing={syncData.syncing}
      syncNotice={syncData.syncNotice}
      onClearSyncNotice={syncData.clearSyncNotice}
      onSyncNow={() => void syncData.syncNow()}
      onOpenSync={() => openSettings("sincronizacao")}
    >
      {activePage === "inicio" && (
        <InicioPage
          equipments={syncData.equipments}
          movements={syncData.movements}
          onNavigate={navigate}
          onQuickUpdateEquipment={syncData.updateEquipment}
          onQuickReturnMovement={syncData.returnMovement}
          onPrintMovement={(item) => setPdfPayload({ kind: "movement", item })}
        />
      )}

      {activePage === "equipamentos" && (
        <EquipamentosPage
          equipments={syncData.equipments}
          movements={syncData.movements}
          onCreate={syncData.createEquipment}
          onUpdate={syncData.updateEquipment}
          onReturnToOwner={syncData.returnEquipmentToOwner}
          onOpenAudit={(item) => setAuditTarget({ entity: "catalog_equipment", entityId: item.id, title: item.name })}
          onPrintReport={(list) =>
            setPdfPayload({
              kind: "equipments_report",
              title: "Equipamentos sob responsabilidade do TI",
              items: list,
              issuedBy: user.full_name
            })
          }
        />
      )}

      {activePage === "movimentacoes" && (
        <MovimentacoesPage
          items={syncData.movements}
          equipments={syncData.equipments}
          sectors={syncData.sectors}
          suggestions={syncData.suggestions}
          loanDefaultDays={settings.loan_default_days ?? 7}
          onCreate={syncData.createMovement}
          onUpdate={syncData.updateMovement}
          onReturn={syncData.returnMovement}
          onCreateSector={syncData.createSector}
          onPrintSingle={(item) => setPdfPayload({ kind: "movement", item })}
          onPrintList={(list, title = "Movimentações de equipamentos") =>
            setPdfPayload({ kind: "movements_report", title, items: list, issuedBy: user.full_name })
          }
          onOpenAudit={(item) =>
            setAuditTarget({ entity: "movement", entityId: item.id, title: `${item.document_code} — ${item.equipment_name}` })
          }
        />
      )}

      {activePage === "configuracoes" && (
        <ConfiguracoesPage
          key={settingsTarget.key}
          initialTab={settingsTarget.tab}
          user={user}
          settings={settings}
          preference={preference}
          systemTheme={systemTheme}
          pwa={pwa}
          users={syncData.users}
          equipments={syncData.equipments}
          movements={syncData.movements}
          sectors={syncData.sectors}
          locations={syncData.locations}
          suggestions={syncData.suggestions}
          online={syncData.online}
          syncing={syncData.syncing}
          pendingCount={syncData.pendingCount}
          failedOps={syncData.failedOps}
          onSyncNow={() => void syncData.syncNow()}
          onRetryFailed={syncData.retryFailed}
          onDiscardFailed={syncData.discardFailed}
          onCreateSector={syncData.createSector}
          onRefresh={syncData.syncNow}
          onChangeTheme={setPreference}
          onChangePassword={changePassword}
          onSettingsUpdated={(updated) => setSettings(updated)}
          onLogoutAll={handleLogoutAll}
        />
      )}

      <PdfModal payload={pdfPayload} settings={settings} onClose={() => setPdfPayload(null)} />
      <AuditDrawer target={auditTarget} onClose={() => setAuditTarget(null)} />
    </AppShell>
  );
}
