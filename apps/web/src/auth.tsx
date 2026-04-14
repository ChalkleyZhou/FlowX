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

let pendingInitialSessionRefresh: Promise<AuthSession | null> | null = null;

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  refreshSession: () => Promise<AuthSession | null>;
  applySession: (nextSession: AuthSession) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function shouldSkipInitialSessionRefresh() {
  if (typeof window === 'undefined') {
    return false;
  }

  if (window.location.pathname !== '/login') {
    return false;
  }

  const searchParams = new URLSearchParams(window.location.search);
  return [
    'token',
    'selectionToken',
    'organizations',
    'error',
    'error_description',
  ].some((key) => searchParams.has(key));
}

async function loadCurrentSession() {
  try {
    return await api.getCurrentSession();
  } catch {
    api.clearAuthToken();
    return null;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshSession() {
    const current = await loadCurrentSession();
    setSession(current);
    setLoading(false);
    return current;
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
    if (shouldSkipInitialSessionRefresh()) {
      setLoading(false);
      return;
    }

    let active = true;

    if (!pendingInitialSessionRefresh) {
      pendingInitialSessionRefresh = loadCurrentSession().finally(() => {
        pendingInitialSessionRefresh = null;
      });
    }

    void pendingInitialSessionRefresh.then((current) => {
      if (!active) {
        return;
      }

      setSession(current);
      setLoading(false);
    });

    return () => {
      active = false;
    };
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
