import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "./api";
import { isAdminLike } from "./roles";

const TOKEN_KEY = "sertex_token_v1";

export const AuthContext = createContext(null);

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
};

export const setToken = (t) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) { console.warn("[auth.js] hata bastırıldı:", e); }
};

// Attach interceptor: send Bearer on every request; on 401 clear token
api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out, obj = logged in

  const refresh = useCallback(async () => {
    const t = getToken();
    if (!t) {
      setUser(null);
      return;
    }
    try {
      const res = await api.get("/auth/me");
      setUser(res.data);
    } catch (e) {
      setToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (username, password) => {
    const res = await api.post("/auth/login", { username, password });
    setToken(res.data.token);
    // Backup real admin session BEFORE overwriting user (in case we re-login as admin later)
    setUser(res.data.user);
    // Clear any previous impersonation state
    try {
      localStorage.removeItem("sertex_admin_backup_v1");
    } catch (e) { console.warn("[auth.js] hata bastırıldı:", e); }
    return res.data.user;
  };

  const impersonate = async (uid) => {
    // Save current admin token+user so we can return
    const currentToken = getToken();
    const currentUser = user;
    try {
      localStorage.setItem(
        "sertex_admin_backup_v1",
        JSON.stringify({ token: currentToken, user: currentUser })
      );
    } catch (e) { console.warn("[auth.js] hata bastırıldı:", e); }
    const res = await api.post(`/admin/users/${uid}/impersonate`);
    setToken(res.data.token);
    setUser({ ...res.data.user, _impersonated: true, _impersonated_by: currentUser?.username });
    return res.data.user;
  };

  const stopImpersonating = () => {
    try {
      const backup = JSON.parse(localStorage.getItem("sertex_admin_backup_v1") || "null");
      if (backup?.token && backup?.user) {
        setToken(backup.token);
        setUser(backup.user);
        localStorage.removeItem("sertex_admin_backup_v1");
        return true;
      }
    } catch (e) { console.warn("[auth.js] hata bastırıldı:", e); }
    return false;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem("sertex_admin_backup_v1");
    } catch (e) { console.warn("[auth.js] hata bastırıldı:", e); }
  };

  // Change the current user's workspace mode ("personal" | "team"). Backend
  // persists in db.users.workspace_mode; we optimistically update the local
  // user object so guards flip instantly across the UI.
  const setWorkspaceMode = useCallback(async (mode) => {
    const res = await api.put("/settings/workspace-mode", { workspace_mode: mode });
    setUser((prev) => (prev ? { ...prev, workspace_mode: res.data.workspace_mode } : prev));
    return res.data.workspace_mode;
  }, []);

  // Çift Mod: açıkken kullanıcı Kişisel⇄Ekip arasında tek tıkla geçer.
  const setDualMode = useCallback(async (enabled) => {
    const res = await api.put("/settings/dual-mode", { dual_mode: !!enabled });
    setUser((prev) => (prev ? { ...prev, dual_mode: res.data.dual_mode } : prev));
    return res.data.dual_mode;
  }, []);

  // Convenience derived flag — true when the user is an admin OR their
  // workspace_mode is "team". Every team-only UI block should gate on this
  // so admins (like Serkan) always see the full B2B feature set regardless
  // of their personal preference.
  const workspaceMode = user?.workspace_mode || "personal";
  const dualMode = !!user?.dual_mode;
  const isOwner = !!user?.is_owner;
  // Faz 8: managers are always in team view — the assignee dropdown, the
  // "Ekibim" tab, and RBAC-gated UI depend on this flag. Admin bypasses the
  // toggle; employees can opt in via workspace_mode='team' from settings.
  const isTeamView = isAdminLike(user) || user?.role === "manager" || workspaceMode === "team";

  // Ekip/B2B özelliklerinin GÖRÜNÜRLÜĞÜ. Kişisel modda ekip özellikleri gizlenir
  // (sadeleştirme) — ANCAK sahip (is_owner) için mod hiçbir şeyi gizlemez.
  const teamFeaturesVisible = isOwner || workspaceMode === "team";

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        refresh,
        impersonate,
        stopImpersonating,
        workspaceMode,
        dualMode,
        isOwner,
        isTeamView,
        teamFeaturesVisible,
        setWorkspaceMode,
        setDualMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
