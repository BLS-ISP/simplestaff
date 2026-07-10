// =============================================================================
// SimpleStaff – Dashboard Page
// =============================================================================

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { Employee, ShiftType, ShiftAssignment, Vacation } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTodayISO(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function formatDateDE(date: Date): string {
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  return `${days[date.getDay()]}, ${date.getDate()}. ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function formatTime(timeStr: string): string {
  return timeStr.substring(0, 5);
}

// ---------------------------------------------------------------------------
// SVG Icons
// ---------------------------------------------------------------------------

const CalendarIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const PeopleIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const InboxIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

const AlertIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

// ---------------------------------------------------------------------------
// Stat Card Component
// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: React.ReactNode;
  value: number;
  label: string;
  gradient: string;
  color: string;
}

function StatCard({ icon, value, label, gradient, color }: StatCardProps) {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 'var(--radius-lg)',
        padding: 1,
        background: gradient,
      }}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          borderRadius: 'calc(var(--radius-lg) - 1px)',
          padding: '24px',
          backdropFilter: 'blur(20px)',
          cursor: 'pointer',
          transition: 'all 250ms ease',
          position: 'relative',
          overflow: 'hidden',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)';
          (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 32px ${color}30`;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
          (e.currentTarget as HTMLElement).style.boxShadow = 'none';
        }}
      >
        {/* Background glow */}
        <div style={{
          position: 'absolute', top: -20, right: -20, width: 80, height: 80,
          borderRadius: '50%', background: `${color}10`, filter: 'blur(20px)', pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
          <div style={{ color, opacity: 0.9 }}>{icon}</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
            {value}
          </div>
        </div>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 500, position: 'relative' }}>
          {label}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="animate-fade-in">
      <div className="skeleton" style={{ height: 32, width: 300, marginBottom: 8 }} />
      <div className="skeleton" style={{ height: 18, width: 220, marginBottom: 32 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 20, marginBottom: 32 }}>
        {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 120, borderRadius: 'var(--radius-lg)' }} />)}
      </div>
      <div className="skeleton" style={{ height: 300, borderRadius: 'var(--radius-lg)' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const userRole = user?.role || 'viewer';
  const isEmployee = userRole === 'viewer';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);

  // Employee-specific state
  const [myEmployee, setMyEmployee] = useState<Employee | null>(null);
  const [myVacations, setMyVacations] = useState<Vacation[]>([]);

  // Manager-specific state
  const [pendingVacationsCount, setPendingVacationsCount] = useState(0);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const today = getTodayISO();
        
        // Fetch assignments for today & shift types
        const [assignRes, stRes] = await Promise.all([
          api.assignments.list({ start_date: today, end_date: today }),
          api.shiftTypes.list(),
        ]);
        setAssignments(assignRes);
        setShiftTypes(stRes);

        if (isEmployee) {
          // Employee profile and vacations
          const emp = await api.employees.getMe();
          setMyEmployee(emp);
          setEmployees([emp]);

          const vacs = await api.vacations.list(emp.id);
          setMyVacations(vacs);
        } else {
          // Manager: list active employees and count pending vacations
          const [empRes, vacsRes] = await Promise.all([
            api.employees.list({ is_active: true }),
            api.vacations.listAll(),
          ]);
          setEmployees(empRes.data);
          setPendingVacationsCount(vacsRes.filter(v => v.status === 'requested').length);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Laden der Dashboard-Daten');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [isEmployee]);

  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="animate-fade-in" style={{ textAlign: 'center', padding: 60 }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>⚠️</div>
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      </div>
    );
  }

  const shiftTypeMap = new Map(shiftTypes.map(st => [st.id, st]));
  const employeeMap = new Map(employees.map(e => [e.id, e]));

  // Filter assignments based on role
  const displayAssignments = isEmployee && myEmployee
    ? assignments.filter(a => a.employee_id === myEmployee.id)
    : assignments;

  const todayShiftsCount = displayAssignments.length;
  const activeEmployees = employees.filter(e => e.is_active).length;

  return (
    <div className="animate-slide-up">
      {/* Welcome */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: '1.75rem', marginBottom: 4 }}>
          {t('dashboard.welcome', 'Willkommen zurück')}, {user?.first_name || 'User'} 👋
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>{formatDateDE(new Date())}</p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 20, marginBottom: 40 }}>
        <StatCard
          icon={<CalendarIcon />}
          value={todayShiftsCount}
          label={isEmployee ? t('dashboard.myTodayShifts', 'Meine Schichten heute') : t('dashboard.todayShifts', 'Heute geplante Schichten')}
          gradient="linear-gradient(135deg, rgba(59,130,246,0.5), rgba(99,102,241,0.3))"
          color="#3b82f6"
        />
        {isEmployee && myEmployee ? (
          <>
            <StatCard
              icon={<PeopleIcon />}
              value={Number(myEmployee.vacation_days_remaining.toFixed(1))}
              label={t('employees.vacationRemaining', 'Verbleibender Resturlaub')}
              gradient="linear-gradient(135deg, rgba(16,185,129,0.5), rgba(5,150,105,0.3))"
              color="#10b981"
            />
            <StatCard
              icon={<InboxIcon />}
              value={myEmployee.vacation_days_per_year}
              label={t('employees.vacationDays', 'Jahresurlaubstage')}
              gradient="linear-gradient(135deg, rgba(245,158,11,0.5), rgba(217,119,6,0.3))"
              color="#f59e0b"
            />
            <StatCard
              icon={<AlertIcon />}
              value={myVacations.filter(v => v.status === 'requested').length}
              label={t('dashboard.myPendingVacations', 'Meine offenen Urlaubsanträge')}
              gradient="linear-gradient(135deg, rgba(239,68,68,0.5), rgba(220,38,38,0.3))"
              color="#ef4444"
            />
          </>
        ) : (
          <>
            <StatCard
              icon={<PeopleIcon />}
              value={activeEmployees}
              label={t('dashboard.activeEmployees', 'Aktive Mitarbeiter')}
              gradient="linear-gradient(135deg, rgba(16,185,129,0.5), rgba(5,150,105,0.3))"
              color="#10b981"
            />
            <StatCard
              icon={<InboxIcon />}
              value={pendingVacationsCount}
              label={t('dashboard.pendingVacations', 'Offene Urlaubsanträge')}
              gradient="linear-gradient(135deg, rgba(245,158,11,0.5), rgba(217,119,6,0.3))"
              color="#f59e0b"
            />
            <StatCard
              icon={<AlertIcon />}
              value={0} // Warnings placeholder
              label={t('dashboard.warnings', 'Warnungen')}
              gradient="linear-gradient(135deg, rgba(239,68,68,0.5), rgba(220,38,38,0.3))"
              color="#ef4444"
            />
          </>
        )}
      </div>

      {/* Today's Assignments Table */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ marginBottom: 16 }}>
          {isEmployee ? t('dashboard.myAssignments', 'Meine heutigen Schichten') : t('dashboard.todayAssignments', 'Heutige Schichtzuweisungen')}
        </h2>
        {displayAssignments.length === 0 ? (
          <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8, opacity: 0.5 }}>📋</div>
            <p style={{ color: 'var(--text-tertiary)' }}>{t('dashboard.noShiftsToday', 'Heute keine Schichten geplant')}</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>{t('shiftPlan.employee', 'Mitarbeiter')}</th>
                  <th>{t('shiftTypes.name', 'Schichttyp')}</th>
                  <th>{t('shiftTypes.startTime', 'Beginn')}</th>
                  <th>{t('shiftTypes.endTime', 'Ende')}</th>
                  <th>{t('common.status', 'Status')}</th>
                  {isEmployee && <th style={{ textAlign: 'right' }}>Aktionen</th>}
                </tr>
              </thead>
              <tbody>
                {displayAssignments.map(a => {
                  const emp = employeeMap.get(a.employee_id);
                  const st = shiftTypeMap.get(a.shift_type_id);
                  return (
                    <tr key={a.id}>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                        {emp ? `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || '—' : '—'}
                      </td>
                      <td>
                        {st ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8,
                            padding: '3px 10px', borderRadius: 'var(--radius-full)',
                            background: `${st.color}20`, color: st.color, fontSize: '0.8125rem', fontWeight: 500,
                          }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.color }} />
                            {st.name}
                          </span>
                        ) : '—'}
                      </td>
                      <td>{st ? formatTime(st.start_time) : '—'}</td>
                      <td>{st ? formatTime(st.end_time) : '—'}</td>
                      <td>
                        <span className={`badge ${a.status === 'planned' ? 'badge-info' : a.status === 'completed' ? 'badge-success' : 'badge-neutral'}`}>
                          {a.status}
                        </span>
                      </td>
                      {isEmployee && (
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-sm btn-neutral"
                            onClick={() => navigate('/shift-swaps')}
                            style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                          >
                            🔄 Tauschen
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Activity / Vacation Requests for Employees */}
      <div>
        <h2 style={{ marginBottom: 16 }}>
          {isEmployee ? t('employees.vacations', 'Meine Urlaubsanträge') : t('dashboard.recentActivity', 'Letzte Aktivitäten')}
        </h2>
        {isEmployee ? (
          myVacations.length === 0 ? (
            <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8, opacity: 0.5 }}>🌴</div>
              <p style={{ color: 'var(--text-tertiary)' }}>Bisher keine Urlaubsanträge eingereicht.</p>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Startdatum</th>
                    <th>Enddatum</th>
                    <th>Notiz</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {myVacations.slice(0, 5).map(v => (
                    <tr key={v.id}>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                        {new Date(v.start_date).toLocaleDateString('de-DE')}
                      </td>
                      <td>{new Date(v.end_date).toLocaleDateString('de-DE')}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{v.notes || '—'}</td>
                      <td>
                        <span className={`badge ${v.status === 'approved' ? 'badge-success' : v.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
                          {v.status === 'approved' ? 'Genehmigt' : v.status === 'rejected' ? 'Abgelehnt' : 'Ausstehend'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8, opacity: 0.5 }}>📊</div>
            <p style={{ color: 'var(--text-tertiary)' }}>{t('dashboard.noActivity', 'Keine aktuellen Aktivitäten')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
