import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client.js';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vp_user')) || null; } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('vp_token')));

  // Re-check the saved session once on load, so a stale token logs out cleanly.
  useEffect(() => {
    if (!localStorage.getItem('vp_token')) return setLoading(false);
    api.get('/auth/me')
      .then(({ data }) => {
        setUser(data.user);
        localStorage.setItem('vp_user', JSON.stringify(data.user));
      })
      .catch(() => {
        localStorage.removeItem('vp_token');
        localStorage.removeItem('vp_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (userId, password) => {
    const { data } = await api.post('/auth/login', { userId, password });
    localStorage.setItem('vp_token', data.token);
    localStorage.setItem('vp_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('vp_token');
    localStorage.removeItem('vp_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
