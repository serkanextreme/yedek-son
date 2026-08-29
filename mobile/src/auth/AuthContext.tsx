// Auth state for the whole app. Token is persisted in SecureStore; the user
// profile is re-fetched from /auth/me on cold start so a kicked / expired
// session resolves to logged-out cleanly.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { api } from "@/src/api/client";
import { User } from "@/src/api/types";
import { storage } from "@/src/utils/storage";
import { AUTH_TOKEN_KEY } from "./storage-keys";

type AuthContextValue = {
  user: User | null;
  token: string | null;
  bootstrapping: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    (async () => {
      const stored = await storage.secureGet<string>(AUTH_TOKEN_KEY, "");
      if (stored) {
        try {
          const me = await api.me();
          setToken(stored);
          setUser(me);
        } catch {
          // Expired / kicked session — drop the stale token silently.
          await storage.secureRemove(AUTH_TOKEN_KEY);
        }
      }
      setBootstrapping(false);
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    await storage.secureSet(AUTH_TOKEN_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await storage.secureRemove(AUTH_TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, bootstrapping, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
