/**
 * AuthProvider — React contextas su:
 *   - user (current logged-in)
 *   - loading (pirmas `auth.me` užklausai)
 *   - login(username, password) — cookie nustatomas backende
 *   - logout() — clear'ina cookie + state
 *
 * ProtectedRoute komponentas redirect'ina į /login jei ne autentifikuotas.
 */
import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { AuthUser } from '@biip-finansai/shared';
import { AUTH_CLEARED_EVENT, authLogin, authLogout, authMe } from '@/lib/api';

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = React.createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await authMe();
        if (!cancelled) {
          setUser(me.user);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const onCleared = (): void => {
      setUser(null);
    };
    window.addEventListener(AUTH_CLEARED_EVENT, onCleared);
    return () => {
      window.removeEventListener(AUTH_CLEARED_EVENT, onCleared);
    };
  }, []);

  const login = React.useCallback(
    async (username: string, password: string): Promise<void> => {
      const result = await authLogin({ username, password });
      setUser(result.user);
    },
    [],
  );

  const logout = React.useCallback(async (): Promise<void> => {
    try {
      await authLogout();
    } catch {
      // Net jei backend nepasiekiamas, lokaliai vis tiek "logout'inam".
    }
    setUser(null);
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

export interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({
  children,
}: ProtectedRouteProps): JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        className="flex h-screen items-center justify-center bg-secondary/40"
        role="status"
        aria-label="Kraunama"
      >
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return <>{children}</>;
}
