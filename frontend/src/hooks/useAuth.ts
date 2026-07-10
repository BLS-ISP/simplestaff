// =============================================================================
// SimpleStaff – Auth Hook
// Simple hook-based auth without Context (no JSX needed)
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { api, setAuthToken, getAuthToken } from '../api/client';
import type { User, UserRole } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => {
    // Try to restore user from localStorage on initial mount
    const storedUser = localStorage.getItem('simplestaff_user');
    return {
      user: storedUser ? JSON.parse(storedUser) : null,
      loading: !storedUser && !!getAuthToken(),
      error: null,
    };
  });

  // Validate token on mount if we have one but no cached user
  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setState({ user: null, loading: false, error: null });
      return;
    }

    // If we already have a cached user, just validate in background
    api.auth.me()
      .then((user) => {
        localStorage.setItem('simplestaff_user', JSON.stringify(user));
        setState({ user, loading: false, error: null });
      })
      .catch(() => {
        setAuthToken(null);
        localStorage.removeItem('simplestaff_user');
        setState({ user: null, loading: false, error: null });
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await api.auth.login({ email, password });
      setAuthToken(response.token);
      const user = await api.auth.me();
      localStorage.setItem('simplestaff_user', JSON.stringify(user));
      setState({ user, loading: false, error: null });
      return user;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login fehlgeschlagen';
      setState((prev) => ({ ...prev, loading: false, error: message }));
      throw err;
    }
  }, []);

  const register = useCallback(async (data: { tenant_name: string; tenant_slug: string; email: string; password: string; first_name: string; last_name: string }) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await api.auth.register(data);
      setAuthToken(response.token);
      const user = await api.auth.me();
      localStorage.setItem('simplestaff_user', JSON.stringify(user));
      setState({ user, loading: false, error: null });
      return user;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registrierung fehlgeschlagen';
      setState((prev) => ({ ...prev, loading: false, error: message }));
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    localStorage.removeItem('simplestaff_user');
    setState({ user: null, loading: false, error: null });
  }, []);

  const hasRole = useCallback(
    (...roles: UserRole[]) => {
      if (!state.user) return false;
      return roles.includes(state.user.role);
    },
    [state.user]
  );

  const isManager = useCallback(() => {
    return hasRole('super_admin', 'admin', 'planner');
  }, [hasRole]);

  const isAdmin = useCallback(() => {
    return hasRole('super_admin', 'admin');
  }, [hasRole]);

  const isSuperAdmin = useCallback(() => {
    return hasRole('super_admin');
  }, [hasRole]);

  return {
    user: state.user,
    loading: state.loading,
    error: state.error,
    login,
    register,
    logout,
    hasRole,
    isManager,
    isAdmin,
    isSuperAdmin,
  };
}
