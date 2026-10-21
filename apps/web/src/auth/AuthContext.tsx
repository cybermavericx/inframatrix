import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { AuthUser } from './types';
import { buildAbility, type AppAbility } from './ability';

type LoginResult = { mfaRequired: false } | { mfaRequired: true; mfaToken: string };

interface AuthState {
  user: AuthUser | null;
  ability: AppAbility;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((r) => {
        // /auth/me returns the JWT payload: { sub, email, modules, permissions }
        setUser({
          id: r.data.sub,
          name: r.data.email,
          email: r.data.email,
          modules: r.data.modules ?? [],
          permissions: r.data.permissions ?? [],
        });
      })
      .catch((e: { response?: { status?: number } }) => {
        // only drop the session on a real auth failure; keep it on transient (network/5xx) errors
        if (e?.response?.status === 401) localStorage.removeItem('accessToken');
      })
      .finally(() => setLoading(false));
  }, []);

  const applySession = (data: { accessToken: string; refreshToken: string; user: AuthUser }) => {
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    setUser(data.user);
  };

  const login = async (email: string, password: string): Promise<LoginResult> => {
    const r = await api.post('/auth/login', { email, password });
    if (r.data.mfaRequired) return { mfaRequired: true, mfaToken: r.data.mfaToken };
    applySession(r.data);
    return { mfaRequired: false };
  };

  const verifyMfa = async (mfaToken: string, code: string) => {
    const r = await api.post('/auth/mfa/verify', { mfaToken, code });
    applySession(r.data);
  };

  const logout = () => {
    // revoke the refresh token server-side (fire-and-forget) so it can't mint new access tokens
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => {});
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUser(null);
  };

  const ability = useMemo(() => buildAbility(user?.permissions ?? []), [user]);

  return (
    <AuthContext.Provider value={{ user, ability, loading, login, verifyMfa, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
