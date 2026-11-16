import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onUnauthorized, request, tokenStore } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));
  const [notice, setNotice] = useState('');

  const clear = useCallback((message = '') => {
    tokenStore.set(null);
    setUser(null);
    setNotice(message);
  }, []);

  const loadMe = useCallback(async () => {
    const me = await request('GET', '/api/auth/me');
    setUser(me.user);
    setMatrix(me.permissionMatrix);
  }, []);

  useEffect(() => {
    onUnauthorized(() => clear('Your session has ended. Please sign in again.'));
    if (!tokenStore.get()) return;
    loadMe().catch(() => clear()).finally(() => setLoading(false));
  }, [clear, loadMe]);

  const value = useMemo(() => ({
    user,
    matrix,
    loading,
    notice,
    can: (permission) => Boolean(user?.permissions.includes(permission)),
    async login(username, password) {
      const { token } = await api.post('/api/auth/login', { username, password });
      tokenStore.set(token);
      setNotice('');
      await loadMe();
    },
    async logout() {
      await api.post('/api/auth/logout').catch(() => {});
      clear();
    },
    async changePassword(currentPassword, newPassword) {
      const { token } = await api.post('/api/auth/change-password', { currentPassword, newPassword });
      tokenStore.set(token);
    },
  }), [user, matrix, loading, notice, loadMe, clear]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
