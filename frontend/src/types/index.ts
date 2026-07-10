// =============================================================================
// SimpleStaff – Shared TypeScript Types
// Mirrors the Rust backend models and API DTOs
// =============================================================================

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

export interface Employee {
  id: string;
  tenant_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  weekly_hours: number;
  monthly_hours: number | null;
  yearly_hours: number | null;
  vacation_days_per_year: number;
  vacation_days_remaining: number;
  shift_preferences: Record<string, number>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateEmployeeRequest {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  weekly_hours?: number;
  monthly_hours?: number;
  yearly_hours?: number;
  vacation_days_per_year?: number;
  vacation_days_remaining?: number;
  shift_preferences?: Record<string, number>;
}

export interface UpdateEmployeeRequest {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  weekly_hours?: number;
  monthly_hours?: number;
  yearly_hours?: number;
  vacation_days_per_year?: number;
  vacation_days_remaining?: number;
  shift_preferences?: Record<string, number>;
  is_active?: boolean;
}

// ---------------------------------------------------------------------------
// Shift Type
// ---------------------------------------------------------------------------

export interface ShiftType {
  id: string;
  tenant_id: string;
  name: string;
  start_time: string; // "HH:MM:SS"
  end_time: string;   // "HH:MM:SS"
  break_minutes: number;
  color: string;
  is_active: boolean;
  valid_days: number[]; // Array of weekday numbers (1=Mon, 7=Sun)
  min_staff: number | null;
  max_staff: number | null;
  holiday_mode: string;
  created_at: string;
  updated_at: string;
}

export interface CreateShiftTypeRequest {
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  color: string;
  valid_days?: number[];
  min_staff?: number | null;
  max_staff?: number | null;
  holiday_mode?: string;
}

export interface UpdateShiftTypeRequest {
  name?: string;
  start_time?: string;
  end_time?: string;
  break_minutes?: number;
  color?: string;
  is_active?: boolean;
  valid_days?: number[];
  min_staff?: number | null;
  max_staff?: number | null;
  holiday_mode?: string;
}

// ---------------------------------------------------------------------------
// Shift Assignment
// ---------------------------------------------------------------------------

export interface ShiftAssignment {
  id: string;
  tenant_id: string;
  employee_id: string;
  shift_type_id: string;
  assignment_date: string; // "YYYY-MM-DD"
  actual_start: string | null;
  actual_end: string | null;
  actual_break_minutes: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAssignmentRequest {
  employee_id: string;
  shift_type_id: string;
  assignment_date: string;
  notes?: string;
}

export interface UpdateAssignmentRequest {
  employee_id?: string;
  shift_type_id?: string;
  assignment_date?: string;
  actual_start?: string;
  actual_end?: string;
  actual_break_minutes?: number;
  status?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Blocked Day
// ---------------------------------------------------------------------------

export interface BlockedDay {
  id: string;
  tenant_id: string;
  employee_id: string;
  blocked_date: string; // "YYYY-MM-DD"
  reason: string | null;
  created_at: string;
}

export interface CreateBlockedDayRequest {
  blocked_date: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Vacation
// ---------------------------------------------------------------------------

export interface Vacation {
  id: string;
  tenant_id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  status: 'requested' | 'approved' | 'rejected';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateVacationRequest {
  start_date: string;
  end_date: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------

export interface TenantSettings {
  max_daily_hours?: number;
  min_rest_hours?: number;
  max_weekly_hours?: number;
  break_rules?: BreakRule[];
}

export interface BreakRule {
  from_hours: number;
  break_minutes: number;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  settings: TenantSettings;
  created_at: string;
  updated_at: string;
}

export interface UpdateTenantRequest {
  name: string;
}

export interface UpdateTenantSettingsRequest {
  settings: TenantSettings;
}

// ---------------------------------------------------------------------------
// Auth / User
// ---------------------------------------------------------------------------

export type UserRole = 'super_admin' | 'admin' | 'planner' | 'viewer';

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
    tenant_id: string;
  };
}

export interface RegisterRequest {
  tenant_name: string;
  tenant_slug: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
}

// ---------------------------------------------------------------------------
// API Pagination
// ---------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface SubscriptionTokenResponse {
  token: string;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardStats {
  today_shifts: number;
  active_employees: number;
  pending_vacations: number;
  warnings: number;
}

// ---------------------------------------------------------------------------
// Closed Days & Public Holidays
// ---------------------------------------------------------------------------

export interface ClosedDay {
  id: string;
  tenant_id: string;
  closed_date: string; // YYYY-MM-DD
  description: string;
  is_holiday: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateClosedDayRequest {
  closed_date: string;
  description: string;
  is_holiday: boolean;
}

// ---------------------------------------------------------------------------
// Shift Swap
// ---------------------------------------------------------------------------

export interface ShiftSwap {
  id: string;
  tenant_id: string;
  assignment_id: string;
  requesting_employee_id: string;
  requesting_employee_name: string;
  target_employee_id: string | null;
  target_employee_name: string | null;
  backup_employee_id: string | null;
  backup_employee_name: string | null;
  status: 'open' | 'proposed' | 'approved' | 'rejected' | 'cancelled';
  notes: string | null;
  created_at: string;
  updated_at: string;
  assignment_date: string;
  shift_type_name: string;
  start_time: string;
  end_time: string;
  color: string;
}

export interface CreateShiftSwapRequest {
  assignment_id: string;
  target_employee_id?: string;
  notes?: string;
}
