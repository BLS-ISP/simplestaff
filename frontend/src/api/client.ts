// =============================================================================
// SimpleStaff – API Client
// Typed fetch wrapper for the Rust/Axum backend
// =============================================================================

import type {
  Employee,
  CreateEmployeeRequest,
  UpdateEmployeeRequest,
  ShiftType,
  CreateShiftTypeRequest,
  UpdateShiftTypeRequest,
  ShiftAssignment,
  CreateAssignmentRequest,
  BlockedDay,
  CreateBlockedDayRequest,
  Vacation,
  CreateVacationRequest,
  Tenant,
  UpdateTenantRequest,
  UpdateTenantSettingsRequest,
  LoginRequest,
  LoginResponse,
  User,
  PaginatedResponse,
  SubscriptionTokenResponse,
  ClosedDay,
  CreateClosedDayRequest,
  ShiftSwap,
  CreateShiftSwapRequest,
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080/api';

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

export function setAuthToken(token: string | null) {
  if (token) {
    localStorage.setItem('simplestaff_token', token);
  } else {
    localStorage.removeItem('simplestaff_token');
  }
}

export function getAuthToken(): string | null {
  return localStorage.getItem('simplestaff_token');
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const method = options.method || 'GET';
  const startTime = Date.now();
  const isDev = import.meta.env.DEV;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (isDev) {
    console.groupCollapsed(
      `%cAPI REQUEST: ${method} ${path}`,
      'color: #6366f1; font-weight: bold; background: rgba(99, 102, 241, 0.08); padding: 2px 6px; border-radius: 4px;'
    );
    if (options.body) {
      try {
        console.log('Payload:', JSON.parse(options.body as string));
      } catch {
        console.log('Payload:', options.body);
      }
    }
    console.groupEnd();
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorBody = await response.text();
      let message: string;
      try {
        const parsed = JSON.parse(errorBody);
        message = parsed.message || (parsed.error && typeof parsed.error === 'object' ? parsed.error.message : parsed.error) || errorBody;
      } catch {
        message = errorBody || response.statusText;
      }

      if (isDev) {
        console.group(
          `%cAPI ERROR: ${method} ${path} → Status ${response.status} (${duration}ms)`,
          'color: #ef4444; font-weight: bold; background: rgba(239, 68, 68, 0.08); padding: 2px 6px; border-radius: 4px;'
        );
        console.error('Error Details:', message);
        console.groupEnd();
      }

      throw new ApiError(response.status, message);
    }

    if (isDev) {
      console.log(
        `%cAPI SUCCESS: ${method} ${path} → Status ${response.status} (${duration}ms)`,
        'color: #10b981; font-weight: bold; background: rgba(16, 185, 129, 0.08); padding: 2px 6px; border-radius: 4px;'
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  } catch (err) {
    if (isDev && !(err instanceof ApiError)) {
      const duration = Date.now() - startTime;
      console.group(
        `%cAPI NETWORK ERROR: ${method} ${path} (${duration}ms)`,
        'color: #dc2626; font-weight: bold; background: rgba(220, 38, 38, 0.08); padding: 2px 6px; border-radius: 4px;'
      );
      console.error(err);
      console.groupEnd();
    }
    throw err;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

const auth = {
  login: (data: LoginRequest) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  register: (data: { tenant_name: string; tenant_slug: string; email: string; password: string; first_name: string; last_name: string }) =>
    request<{ token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  me: () => request<User>('/auth/me'),
};

// ---------------------------------------------------------------------------
// Employee endpoints
// ---------------------------------------------------------------------------

const employees = {
  list: (params?: { page?: number; per_page?: number; is_active?: boolean }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.per_page) searchParams.set('per_page', String(params.per_page));
    if (params?.is_active !== undefined) searchParams.set('is_active', String(params.is_active));
    const qs = searchParams.toString();
    return request<PaginatedResponse<Employee>>(`/employees${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) =>
    request<Employee>(`/employees/${id}`),

  getMe: () =>
    request<Employee>('/employees/me'),

  create: (data: CreateEmployeeRequest) =>
    request<Employee>('/employees', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: UpdateEmployeeRequest) =>
    request<Employee>(`/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<Employee>(`/employees/${id}`, { method: 'DELETE' }),

  createUser: (id: string, password?: string) =>
    request<any>(`/employees/${id}/create-user`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
};

// ---------------------------------------------------------------------------
// Blocked Days endpoints
// ---------------------------------------------------------------------------

const blockedDays = {
  list: (employeeId: string) =>
    request<BlockedDay[]>(`/employees/${employeeId}/blocked-days`),

  create: (employeeId: string, data: CreateBlockedDayRequest) =>
    request<BlockedDay>(`/employees/${employeeId}/blocked-days`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (employeeId: string, id: string) =>
    request<{ deleted: boolean }>(`/employees/${employeeId}/blocked-days/${id}`, {
      method: 'DELETE',
    }),
};

// ---------------------------------------------------------------------------
// Vacation endpoints
// ---------------------------------------------------------------------------

const vacations = {
  list: (employeeId: string) =>
    request<Vacation[]>(`/employees/${employeeId}/vacations`),

  listAll: () =>
    request<(Vacation & { employee_name: string })[]>('/vacations'),

  create: (employeeId: string, data: CreateVacationRequest) =>
    request<Vacation>(`/employees/${employeeId}/vacations`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  approve: (employeeId: string, vacationId: string) =>
    request<Vacation>(`/employees/${employeeId}/vacations/${vacationId}/approve`, {
      method: 'PUT',
    }),

  reject: (employeeId: string, vacationId: string) =>
    request<Vacation>(`/employees/${employeeId}/vacations/${vacationId}/reject`, {
      method: 'PUT',
    }),
};

// ---------------------------------------------------------------------------
// Shift Type endpoints
// ---------------------------------------------------------------------------

const shiftTypes = {
  list: () => request<ShiftType[]>('/shift-types'),

  create: (data: CreateShiftTypeRequest) =>
    request<ShiftType>('/shift-types', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: UpdateShiftTypeRequest) =>
    request<ShiftType>(`/shift-types/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ message: string }>(`/shift-types/${id}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Assignment endpoints
// ---------------------------------------------------------------------------

const assignments = {
  list: (params?: { start_date?: string; end_date?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.start_date) searchParams.set('start_date', params.start_date);
    if (params?.end_date) searchParams.set('end_date', params.end_date);
    const qs = searchParams.toString();
    return request<ShiftAssignment[]>(`/assignments${qs ? `?${qs}` : ''}`);
  },

  getWeek: (date: string) =>
    request<ShiftAssignment[]>(`/assignments/week/${date}`),

  getMonth: (date: string) =>
    request<ShiftAssignment[]>(`/assignments/month/${date}`),

  create: (data: CreateAssignmentRequest) =>
    request<ShiftAssignment>('/assignments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<CreateAssignmentRequest>) =>
    request<ShiftAssignment>(`/assignments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ deleted: boolean; id: string }>(`/assignments/${id}`, {
      method: 'DELETE',
    }),

  autoSchedule: (data: { start_date: string; end_date: string }) =>
    request<{ success: boolean; message: string }>('/assignments/auto-schedule', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ---------------------------------------------------------------------------
// Tenant endpoints
// ---------------------------------------------------------------------------

const tenants = {
  get: () => request<Tenant>('/tenants'),

  update: (data: UpdateTenantRequest) =>
    request<Tenant>('/tenants', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  updateSettings: (data: UpdateTenantSettingsRequest) =>
    request<Tenant>('/tenants/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

// ---------------------------------------------------------------------------
// Calendar endpoints
// ---------------------------------------------------------------------------

const calendar = {
  getIcsUrl: (employeeId: string) =>
    `${API_BASE}/calendar/${employeeId}`,

  downloadIcs: async (employeeId: string) => {
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${API_BASE}/calendar/${employeeId}`, {
      headers,
    });
    if (!res.ok) {
      throw new Error(`Failed to download ICS: ${res.statusText}`);
    }
    return res.text();
  },

  generateSubscriptionToken: (employeeId: string) =>
    request<SubscriptionTokenResponse>(`/calendar/subscribe/generate/${employeeId}`, {
      method: 'POST',
    }),

  getSubscriptionUrl: (token: string) => {
    const base = API_BASE.startsWith('/')
      ? `${window.location.origin}${API_BASE}`
      : API_BASE;
    return `${base}/calendar/subscribe/${token}`;
  },
};

// ---------------------------------------------------------------------------
// Closed Days & Public Holidays endpoints
// ---------------------------------------------------------------------------

const closedDays = {
  list: (params?: { start_date?: string; end_date?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.start_date) searchParams.set('start_date', params.start_date);
    if (params?.end_date) searchParams.set('end_date', params.end_date);
    const qs = searchParams.toString();
    return request<ClosedDay[]>(`/closed-days${qs ? `?${qs}` : ''}`);
  },

  create: (data: CreateClosedDayRequest) =>
    request<ClosedDay>('/closed-days', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ success: boolean; message: string }>(`/closed-days/${id}`, {
      method: 'DELETE',
    }),
};

// ---------------------------------------------------------------------------
// Shift Swaps endpoints
// ---------------------------------------------------------------------------

const shiftSwaps = {
  list: () =>
    request<ShiftSwap[]>('/shift-swaps'),

  create: (data: CreateShiftSwapRequest) =>
    request<ShiftSwap>('/shift-swaps', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  claim: (id: string) =>
    request<ShiftSwap>(`/shift-swaps/${id}/claim`, {
      method: 'PUT',
    }),

  approve: (id: string) =>
    request<any>(`/shift-swaps/${id}/approve`, {
      method: 'PUT',
    }),

  reject: (id: string) =>
    request<ShiftSwap>(`/shift-swaps/${id}/reject`, {
      method: 'PUT',
    }),

  delete: (id: string) =>
    request<{ success: boolean; message: string }>(`/shift-swaps/${id}`, {
      method: 'DELETE',
    }),
};

// ---------------------------------------------------------------------------
// Admin endpoints (for super_admin)
// ---------------------------------------------------------------------------

export interface TenantAdminInfo {
  id: string;
  name: string;
  slug: string;
  max_employees: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTenantAdminRequest {
  name: string;
  slug: string;
  max_employees: number | null;
  manager_email: string;
  manager_password: string;
  manager_first_name: string;
  manager_last_name: string;
}

export interface UpdateTenantAdminRequest {
  name: string;
  slug: string;
  max_employees: number | null;
}

const admin = {
  listTenants: () =>
    request<TenantAdminInfo[]>('/admin/tenants'),

  createTenant: (data: CreateTenantAdminRequest) =>
    request<TenantAdminInfo>('/admin/tenants', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTenant: (id: string, data: UpdateTenantAdminRequest) =>
    request<TenantAdminInfo>(`/admin/tenants/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteTenant: (id: string) =>
    request<{ success: boolean }>(`/admin/tenants/${id}`, {
      method: 'DELETE',
    }),
};

// ---------------------------------------------------------------------------
// Validation endpoints
// ---------------------------------------------------------------------------

export interface ValidationWarning {
  code: string;
  message_de: string;
  message_en: string;
  severity: 'Warning' | 'Critical';
}

export interface ValidateResponse {
  warnings: ValidationWarning[];
  is_valid: boolean;
}

const validation = {
  validate: (data: { employee_id: string; shift_type_id: string; assignment_date: string }) =>
    request<ValidateResponse>('/validate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ---------------------------------------------------------------------------
// Unified API export (both named and default for compatibility)
// ---------------------------------------------------------------------------

export const api = {
  auth,
  admin,
  employees,
  blockedDays,
  vacations,
  shiftTypes,
  assignments,
  tenants,
  calendar,
  validation,
  closedDays,
  shiftSwaps,
};

export default api;
