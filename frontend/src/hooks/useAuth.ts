// =============================================================================
// SimpleStaff – Auth Hook
// Simple hook-based auth without Context (no JSX needed)
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { api, setAuthToken, getAuthToken } from '../api/client';
import type { User, UserRole, TenantChoiceInfo } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

export interface LoginResult {
  user: User | null;
  requiresTenantSelection: boolean;
  availableTenants: TenantChoiceInfo[];
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => {
    const storedUser = localStorage.getItem('simplestaff_user');
    return {
      user: storedUser ? JSON.parse(storedUser) : null,
      loading: !storedUser && !!getAuthToken(),
      error: null,
    };
  });

  const refreshUser = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setState({ user: null, loading: false, error: null });
      return null;
    }
    try {
      const user = await api.auth.me();
      localStorage.setItem('simplestaff_user', JSON.stringify(user));
      setState({ user, loading: false, error: null });
      return user;
    } catch {
      setAuthToken(null);
      localStorage.removeItem('simplestaff_user');
      setState({ user: null, loading: false, error: null });
      return null;
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string, tenant_id?: string): Promise<LoginResult> => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await api.auth.login({ email, password, tenant_id });
      if (response.requires_tenant_selection) {
        setState((prev) => ({ ...prev, loading: false, error: null }));
        return {
          user: null,
          requiresTenantSelection: true,
          availableTenants: response.available_tenants || [],
        };
      }

      setAuthToken(response.token);
      const user = await api.auth.me();
      localStorage.setItem('simplestaff_user', JSON.stringify(user));
      setState({ user, loading: false, error: null });
      return {
        user,
        requiresTenantSelection: false,
        availableTenants: response.available_tenants || [],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login fehlgeschlagen';
      setState((prev) => ({ ...prev, loading: false, error: message }));
      throw err;
    }
  }, []);

  const switchTenant = useCallback(async (tenant_id: string, password?: string): Promise<User> => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await api.auth.switchTenant({ tenant_id, password });
      setAuthToken(response.token);
      const user = await api.auth.me();
      localStorage.setItem('simplestaff_user', JSON.stringify(user));
      setState({ user, loading: false, error: null });
      return user;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Mandantenwechsel fehlgeschlagen';
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
    switchTenant,
    refreshUser,
    register,
    logout,
    hasRole,
    isManager,
    isAdmin,
    isSuperAdmin,
  };
}
