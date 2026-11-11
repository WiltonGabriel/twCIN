import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AppShell } from "./components/AppShell";
import type { PdfPayload } from "./components/PdfModal";
import { useAuth } from "./hooks/useAuth";
import { usePwaInstall } from "./hooks/usePwaInstall";
import { useSyncData } from "./hooks/useSyncData";
import { useTheme } from "./hooks/useTheme";
import { clearAllLocalData } from "./offline/db";
import { getPendingSyncCount } from "./offline/syncEngine";
import { apiRequest } from "./services/api";
import type { SettingsTab } from "./pages/ConfiguracoesPage";
import { ForcePasswordChangePage } from "./pages/ForcePasswordChangePage";
import { InicioPage } from "./pages/InicioPage";
import { LoginPage } from "./pages/LoginPage";
import { applyOrganizationAppearance } from "./theme/appearance";
import type { PageKey, PublicSettings } from "./types";

const EquipamentosPage = lazy(() => import("./pages/EquipamentosPage").then((m) => ({ default: m.EquipamentosPage })));
const MovimentacoesPage = lazy(() => import("./pages/MovimentacoesPage").then((m) => ({ default: m.MovimentacoesPage })));
const SetoresPage = lazy(() => import("./pages/SetoresPage").then((m) => ({ default: m.SetoresPage })));
const ConfiguracoesPage = lazy(() => import("./pages/ConfiguracoesPage").then((m) => ({ default: m.ConfiguracoesPage })));
const PdfModal = lazy(() => import("./components/PdfModal").then((m) => ({ default: m.PdfModal })));
const AuditDrawer = lazy(() => import("./components/AuditDrawer").then((m) => ({ default: m.AuditDrawer })));

function PageFallback() {
  return (
    <div className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
      Carregando...
    </div>
  );
}

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
    setUser,
    refreshSession
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
  const [previewAppearance, setPreviewAppearance] = useState<PublicSettings | null>(null);
  const [logoutPrompt, setLogoutPrompt] = useState<{ pendingCount: number } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutDialogRef = useRef<HTMLDialogElement>(null);

  const resolvedTheme = preference === "system" ? systemTheme : preference;
  useEffect(() => {
    applyOrganizationAppearance(previewAppearance ?? settings, resolvedTheme);
  }, [previewAppearance, settings, resolvedTheme]);

  useEffect(() => {
    const dialog = logoutDialogRef.current;
    if (!dialog) return;
    if (logoutPrompt && !dialog.open) dialog.showModal();
    else if (!logoutPrompt && dialog.open) dialog.close();
  }, [logoutPrompt]);

  useEffect(() => {
    const dialog = logoutDialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      dialog.returnValue = "";
      setLogoutPrompt(null);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

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

  const requestLogout = async () => {
    const pending = user ? await getPendingSyncCount(user.id) : 0;
    setLogoutPrompt({ pendingCount: pending });
  };

  const confirmLogout = async () => {
    setLoggingOut(true);
    try {
      setLogoutPrompt(null);
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  const handleLogoutAll = async () => {
    await apiRequest("/api/auth/logout-all", { method: "POST", body: JSON.stringify({}) });
    await logout();
  };

  const handleRestoreInitial = async (backupBase64: string) => {
    const res = await apiRequest<{
      restored_users: number;
      restored_equipments: number;
      restored_movements: number;
    }>("/api/backup/restore-initial", {
      method: "POST",
      body: JSON.stringify({ backup_base64: backupBase64 })
    });
    await clearAllLocalData();
    await refreshSession();
    return res;
  };

  const handleBackupRestored = async () => {
    await clearAllLocalData();
    await refreshSession();
    await syncData.syncNow();
  };

  const logoutDialog = (
    <dialog
      ref={logoutDialogRef}
      aria-labelledby="logout-confirm-title"
      className="m-auto w-[min(94vw,420px)] rounded-xl p-5 shadow-xl"
    >
      {logoutPrompt && (
        <div className="space-y-4">
          <h2 id="logout-confirm-title" className="text-base font-semibold">
            Sair da conta?
          </h2>
          {logoutPrompt.pendingCount > 0 ? (
            <div
              role="alert"
              className="px-3 py-2.5 rounded-lg border text-sm"
              style={{ backgroundColor: "var(--warn-soft)", borderColor: "var(--warn)", color: "var(--warn)" }}
            >
              Há <strong>{logoutPrompt.pendingCount}</strong> alteração(ões) feita(s) offline que ainda não chegaram ao
              servidor. Se você sair agora, elas serão perdidas neste dispositivo.
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Sua sessão será encerrada neste dispositivo e os dados em cache local serão limpos.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" autoFocus className="tw-btn" onClick={() => setLogoutPrompt(null)}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={loggingOut}
              className="tw-btn tw-btn-danger"
              onClick={() => void confirmLogout()}
            >
              {loggingOut ? "Saindo..." : "Sair da conta"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>
        Carregando...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        needsSetup={needsSetup}
        settings={settings}
        onLogin={login}
        onSetupInitial={setupInitial}
        onRestoreInitial={handleRestoreInitial}
      />
    );
  }

  if (user.must_change_password) {
    return (
      <>
        <ForcePasswordChangePage
          user={user}
          settings={settings}
          onChangePassword={changePassword}
          onLogout={() => void requestLogout()}
        />
        {logoutDialog}
      </>
    );
  }

  return (
    <>
      <AppShell
        user={user}
        settings={settings}
        activePage={activePage}
        onNavigate={navigate}
        onOpenAccount={() => openSettings("conta")}
        onLogout={() => void requestLogout()}
        online={syncData.online}
        pendingCount={syncData.pendingCount}
        failedCount={syncData.failedOps.length}
        syncing={syncData.syncing}
        justSynced={syncData.justSynced}
        syncNotice={syncData.syncNotice}
        onClearSyncNotice={syncData.clearSyncNotice}
        onSyncNow={() => void syncData.syncNow({ manual: true })}
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
        <Suspense fallback={<PageFallback />}>
          <EquipamentosPage
            equipments={syncData.equipments}
            movements={syncData.movements}
            sectors={syncData.sectors}
            suggestions={syncData.suggestions}
            onCreate={syncData.createEquipment}
            onUpdate={syncData.updateEquipment}
            onReturnToOwner={syncData.returnEquipmentToOwner}
            onCreateSector={syncData.createSector}
            onOpenAudit={(item) => setAuditTarget({ entity: "catalog_equipment", entityId: item.id, title: item.name })}
            onPrintReport={(list, title = "Equipamentos sob responsabilidade do TI") =>
              setPdfPayload({
                kind: "equipments_report",
                title,
                items: list,
                issuedBy: user.full_name
              })
            }
            onPrintReceipt={(item) => setPdfPayload({ kind: "equipment_receipt", item })}
          />
        </Suspense>
      )}

      {activePage === "movimentacoes" && (
        <Suspense fallback={<PageFallback />}>
          <MovimentacoesPage
            items={syncData.movements}
            equipments={syncData.equipments}
            sectors={syncData.sectors}
            locations={syncData.locations}
            suggestions={syncData.suggestions}
            online={syncData.online}
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
        </Suspense>
      )}

      {activePage === "setores" && (
        <Suspense fallback={<PageFallback />}>
          <SetoresPage
            sectors={syncData.sectors}
            equipments={syncData.equipments}
            movements={syncData.movements}
            onPrintMovement={(item) => setPdfPayload({ kind: "movement", item })}
            onPrintEquipmentReceipt={(item) => setPdfPayload({ kind: "equipment_receipt", item })}
            onPrintDossier={(dossier) =>
              setPdfPayload({ kind: "sector_dossier", ...dossier, issuedBy: user.full_name })
            }
          />
        </Suspense>
      )}

      {activePage === "configuracoes" && (
        <Suspense fallback={<PageFallback />}>
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
            onSyncNow={() => void syncData.syncNow({ manual: true })}
            onRetryFailed={syncData.retryFailed}
            onDiscardFailed={syncData.discardFailed}
            onCreateSector={syncData.createSector}
            onRefresh={syncData.syncNow}
            onChangeTheme={setPreference}
            onChangePassword={changePassword}
            onSettingsUpdated={(updated) => setSettings(updated)}
            onPreviewAppearance={setPreviewAppearance}
            onBackupRestored={handleBackupRestored}
            onLogoutAll={handleLogoutAll}
          />
        </Suspense>
      )}

      {pdfPayload && (
        <Suspense fallback={null}>
          <PdfModal payload={pdfPayload} settings={settings} onClose={() => setPdfPayload(null)} />
        </Suspense>
      )}
      {auditTarget && (
        <Suspense fallback={null}>
          <AuditDrawer target={auditTarget} onClose={() => setAuditTarget(null)} />
        </Suspense>
      )}
    </AppShell>
    {logoutDialog}
    </>
  );
}
