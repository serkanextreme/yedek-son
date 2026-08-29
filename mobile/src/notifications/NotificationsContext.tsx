// Provides the unread-notification count to the tab badge + notifications
// screen. Polls the backend every 30s and exposes a manual refresh so the
// badge updates immediately after the user reads/deletes notifications.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { api } from "@/src/api/client";

type NotificationsContextValue = {
  unread: number;
  refresh: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue | undefined>(
  undefined,
);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await api.unreadCount();
      setUnread(r.unread);
    } catch {
      // ignore (e.g. logged out / offline) — keep last known value
    }
  }, []);

  useEffect(() => {
    refresh();
    const handle = setInterval(refresh, 30000);
    return () => clearInterval(handle);
  }, [refresh]);

  return (
    <NotificationsContext.Provider value={{ unread, refresh }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
