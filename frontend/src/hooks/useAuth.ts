import { useCallback, useEffect, useState } from "react";
import {
  clearLocalDataForLogout,
  getCachedSettings,
  getCachedUser,
  saveCachedSettings,
  saveCachedUser
} from "../offline/db";
import { runSyncCycle } from "../offline/syncEngine";
import { apiRequest, ApiError, isNetworkError } from "../services/api";
import type { AuthUser, PublicSettings } from "../types";

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [settings, setSettings] = useState<PublicSettings>({
    app_name: "twCIN",
    org_name: "Setor de TI",
    logo_data_url: ""
  });
  const [loading, setLoading] = useState(true);

  const loadPublicSettings = useCallback(async () => {
    try {
      const res = await apiRequest<{ settings: PublicSettings }>("/api/settings/public");
      setSettings(res.settings);
      await saveCachedSettings(res.settings);
    } catch {
      const cached = await getCachedSettings();
      setSettings(cached);
    }
  }, []);

  const checkSession = useCallback(async () => {
    try {
      await loadPublicSettings();
      const status = await apiRequest<{ needs_setup: boolean }>("/api/auth/status");
      setNeedsSetup(status.needs_setup);
      if (status.needs_setup) {
        setUser(null);
        await saveCachedUser(null);
        return;
      }

      const data = await apiRequest<{ user: AuthUser }>("/api/auth/me");
      setUser(data.user);
      await saveCachedUser(data.user);
    } catch (err) {
      // Só 401/403 significam sessão inválida. Antes qualquer erro (ex.: 429 do rate limit ou 500)
      // apagava o usuário em cache e mandava para o login.
      const sessionRejected = err instanceof ApiError && (err.status === 401 || err.status === 403);
      if (isNetworkError(err) || !sessionRejected) {
        const cached = await getCachedUser();
        setUser(cached);
      } else {
        setUser(null);
        await saveCachedUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, [loadPublicSettings]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const setupInitial = async (payload: {
    full_name: string;
    username: string;
    password: string;
    app_name?: string;
    org_name?: string;
  }): Promise<AuthUser> => {
    const data = await apiRequest<{ user: AuthUser }>("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setNeedsSetup(false);
    setUser(data.user);
    await saveCachedUser(data.user);
    await loadPublicSettings();
    void runSyncCycle(data.user.id);
    return data.user;
  };

  const login = async (username: string, password: string): Promise<AuthUser> => {
    const data = await apiRequest<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    setNeedsSetup(false);
    setUser(data.user);
    await saveCachedUser(data.user);
    if (!data.user.must_change_password) {
      void runSyncCycle(data.user.id);
    }
    return data.user;
  };

  const changePassword = async (currentPassword: string, newPassword: string): Promise<AuthUser> => {
    const data = await apiRequest<{ user: AuthUser }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword
      })
    });
    setUser(data.user);
    await saveCachedUser(data.user);
    void runSyncCycle(data.user.id);
    return data.user;
  };

  /**
   * Encerra a sessão e apaga deste aparelho os dados da organização e as operações do usuário.
   * Quem chama deve confirmar com a pessoa antes, caso existam operações pendentes
   * (ver getPendingSyncCount): elas são perdidas.
   */
  const logout = async (): Promise<void> => {
    const userId = user?.id;
    try {
      await apiRequest("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
    } catch {
      // Clear local session even if offline
    }
    setUser(null);
    await saveCachedUser(null);
    if (userId !== undefined) {
      await clearLocalDataForLogout(userId);
    }
  };

  return {
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
    refreshSettings: loadPublicSettings
  };
}
