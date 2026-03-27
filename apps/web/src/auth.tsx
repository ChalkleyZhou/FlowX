import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { api } from './api';
import type { AuthSession } from './types';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  refreshSession: () => Promise<AuthSession | null>;
  applySession: (nextSession: AuthSession) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshSession() {
    try {
      const current = await api.getCurrentSession();
      setSession(current);
      return current;
    } catch {
      api.clearAuthToken();
      setSession(null);
      return null;
    } finally {
      setLoading(false);
    }
  }

  function applySession(nextSession: AuthSession) {
    api.setAuthToken(nextSession.token);
    setSession(nextSession);
  }

  function logout() {
    api.clearAuthToken();
    setSession(null);
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      refreshSession,
      applySession,
      logout,
    }),
    [loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}
