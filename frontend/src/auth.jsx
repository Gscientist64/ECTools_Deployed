import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try { const u = await api.me(); setMe(u); }
    catch { setMe(null); }
    finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  const value = { me, setMe, loading, refresh,
    async login(username, password){ const res = await api.login(username, password); await refresh(); return res; },
    async signup(payload){ const res = await api.signup(payload); return res; },
    async logout(){ await api.logout(); setMe(null); }
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
