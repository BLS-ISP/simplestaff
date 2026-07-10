import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ValidationWarning } from '../api/client';
import type { Employee, ShiftType, ShiftAssignment, Vacation, BlockedDay } from '../types';

// ── Helper Functions ──────────────────────────────────────────

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDaysOfWeek(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function formatDateDE(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.`;
}

function toISODateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getShiftDurationHours(st: ShiftType): number {
  const [sH, sM] = st.start_time.split(':').map(Number);
  const [eH, eM] = st.end_time.split(':').map(Number);

  let startMinutes = sH * 60 + sM;
  let endMinutes = eH * 60 + eM;

  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60; // crosses midnight
  }

  let totalMinutes = endMinutes - startMinutes - st.break_minutes;
  return Math.max(0, totalMinutes / 60);
}

const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// ── Component ─────────────────────────────────────────────────

export default function ShiftPlanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [currentMonday, setCurrentMonday] = useState(() => getMonday(new Date()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [vacationMap, setVacationMap] = useState<Record<string, Vacation[]>>({});
  const [blockedMap, setBlockedMap] = useState<Record<string, BlockedDay[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>('');

  // Dropdown state for assigning shifts
  const [activeCell, setActiveCell] = useState<{ empId: string; dateStr: string } | null>(null);

  // Validation state
  const [proposedAssignment, setProposedAssignment] = useState<{
    employeeId: string;
    dateStr: string;
    shiftTypeId: string;
  } | null>(null);
  const [validationWarnings, setValidationWarnings] = useState<ValidationWarning[]>([]);
  const [showValidationModal, setShowValidationModal] = useState(false);

  // Auto scheduling state
  const [showAutoModal, setShowAutoModal] = useState(false);
  const [autoStartDate, setAutoStartDate] = useState(() => toISODateString(currentMonday));
  const [autoEndDate, setAutoEndDate] = useState(() => {
    const sun = new Date(currentMonday);
    sun.setDate(sun.getDate() + 6);
    return toISODateString(sun);
  });
  const [autoScheduling, setAutoScheduling] = useState(false);
  const [autoScheduleError, setAutoScheduleError] = useState<string | null>(null);

  const openAutoModal = () => {
    setAutoStartDate(toISODateString(currentMonday));
    const sun = new Date(currentMonday);
    sun.setDate(sun.getDate() + 6);
    setAutoEndDate(toISODateString(sun));
    setAutoScheduleError(null);
    setShowAutoModal(true);
  };

  const handleAutoSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!autoStartDate || !autoEndDate) return;
    
    const todayStr = toISODateString(new Date());
    if (autoStartDate < todayStr) {
      setAutoScheduleError('Dienstpläne in der Vergangenheit dürfen nicht automatisch besetzt werden.');
      return;
    }
    if (autoEndDate < autoStartDate) {
      setAutoScheduleError('Das Enddatum darf nicht vor dem Startdatum liegen.');
      return;
    }

    try {
      setAutoScheduling(true);
      setAutoScheduleError(null);
      await api.assignments.autoSchedule({
        start_date: autoStartDate,
        end_date: autoEndDate,
      });
      setShowAutoModal(false);
      await fetchData(false);
    } catch (err) {
      console.error(err);
      setAutoScheduleError(err instanceof Error ? err.message : 'Fehler bei der Dienstplangenerierung.');
    } finally {
      setAutoScheduling(false);
    }
  };

  const days = useMemo(() => getDaysOfWeek(currentMonday), [currentMonday]);
  const weekNumber = useMemo(() => getISOWeekNumber(currentMonday), [currentMonday]);
  const todayStr = useMemo(() => toISODateString(new Date()), []);

  const shiftTypeMap = useMemo(() => {
    const map: Record<string, ShiftType> = {};
    for (const st of shiftTypes) map[st.id] = st;
    return map;
  }, [shiftTypes]);

  // Build assignment lookup: `empId|date` → ShiftAssignment
  const assignmentLookup = useMemo(() => {
    const map: Record<string, ShiftAssignment> = {};
    for (const a of assignments) {
      map[`${a.employee_id}|${a.assignment_date}`] = a;
    }
    return map;
  }, [assignments]);

  // Build vacation lookup: `empId|date` → true
  const vacationLookup = useMemo(() => {
    const set = new Set<string>();
    for (const [empId, vacs] of Object.entries(vacationMap)) {
      for (const v of vacs) {
        // Vacation has start_date and end_date – mark every day
        const start = new Date(v.start_date);
        const end = new Date(v.end_date);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          set.add(`${empId}|${toISODateString(d)}`);
        }
      }
    }
    return set;
  }, [vacationMap]);

  // Build blocked lookup: `empId|date` → true
  const blockedLookup = useMemo(() => {
    const set = new Set<string>();
    for (const [empId, blocked] of Object.entries(blockedMap)) {
      for (const b of blocked) {
        set.add(`${empId}|${b.blocked_date}`);
      }
    }
    return set;
  }, [blockedMap]);

  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError(null);
    try {
      const mondayStr = toISODateString(currentMonday);
      const [empRes, stRes, assignRes, tenantRes] = await Promise.all([
        api.employees.list({ is_active: true }),
        api.shiftTypes.list(),
        api.assignments.getWeek(mondayStr),
        api.tenants.get().catch(() => ({ name: 'SimpleStaff' } as any)),
      ]);

      const emps = Array.isArray(empRes) ? empRes : (empRes as any).data ?? [];
      setEmployees(emps);
      setShiftTypes(stRes);
      setAssignments(assignRes);
      setTenantName(tenantRes?.name || 'SimpleStaff');

      // Fetch vacations + blocked days for all employees
      const vacPromises = emps.map((e: Employee) =>
        api.vacations.list(e.id).then((v) => [e.id, v] as const).catch(() => [e.id, []] as const)
      );
      const blockPromises = emps.map((e: Employee) =>
        api.blockedDays.list(e.id).then((b) => [e.id, b] as const).catch(() => [e.id, []] as const)
      );

      const vacResults = await Promise.all(vacPromises);
      const blockResults = await Promise.all(blockPromises);

      const vMap: Record<string, Vacation[]> = {};
      for (const [id, v] of vacResults) vMap[id] = v;
      setVacationMap(vMap);

      const bMap: Record<string, BlockedDay[]> = {};
      for (const [id, b] of blockResults) bMap[id] = b;
      setBlockedMap(bMap);
    } catch {
      setError(t('shiftPlan.loadError', 'Daten konnten nicht geladen werden.'));
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [currentMonday, t]);

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // ── Navigation ──
  const goToPrevWeek = () => {
    setCurrentMonday((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  };

  const goToNextWeek = () => {
    setCurrentMonday((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  };

  const goToToday = () => {
    setCurrentMonday(getMonday(new Date()));
  };

  const handleExportCSV = () => {
    const headers = ['Mitarbeiter', ...days.map(d => toISODateString(d))];
    const rows = employees.map(emp => {
      const rowCells = [
        getEmployeeName(emp),
        ...days.map(d => {
          const dateStr = toISODateString(d);
          const ass = assignmentLookup[`${emp.id}|${dateStr}`];
          if (ass) {
            const st = shiftTypeMap[ass.shift_type_id];
            return st ? `${st.name} (${st.start_time.substring(0, 5)}-${st.end_time.substring(0, 5)})` : 'Schicht';
          }
          if (vacationLookup.has(`${emp.id}|${dateStr}`)) return 'Urlaub';
          if (blockedLookup.has(`${emp.id}|${dateStr}`)) return 'Gesperrt';
          return '';
        })
      ];
      return rowCells.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(';');
    });

    const creationTime = new Date().toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const metaLines = [
      `"Dienstplan";"Woche ${weekNumber} (${mondayStr} - ${sundayStr})"`,
      `"Betrieb";"${tenantName || 'SimpleStaff'}"`,
      `"Erstellt am";"${creationTime} Uhr"`,
      `""`,
    ];

    const tableHeaderLine = headers.map(h => `"${h}"`).join(';');
    const legendLines = [
      `""`,
      `"Schicht-Legende:"`,
      ...shiftTypes.map(st => `"${st.name}";"${st.start_time.substring(0, 5)} - ${st.end_time.substring(0, 5)}"`),
    ];

    const csvContent = '\uFEFF' + [
      ...metaLines,
      tableHeaderLine,
      ...rows,
      ...legendLines
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const year = currentMonday.getFullYear();
    link.download = `dienstplan_kw_${weekNumber}_${year}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ── Assignment Actions ──
  const handleAssign = async (employeeId: string, dateStr: string, shiftTypeId: string, force: boolean = false) => {
    setActiveCell(null);
    try {
      if (!force) {
        // Run validation check
        const res = await api.validation.validate({
          employee_id: employeeId,
          shift_type_id: shiftTypeId,
          assignment_date: dateStr,
        });

        if (res.warnings && res.warnings.length > 0) {
          // Show warning modal
          setProposedAssignment({ employeeId, dateStr, shiftTypeId });
          setValidationWarnings(res.warnings);
          setShowValidationModal(true);
          return;
        }
      }

      await api.assignments.create({
        employee_id: employeeId,
        shift_type_id: shiftTypeId,
        assignment_date: dateStr,
      });
      fetchData(false);
      setProposedAssignment(null);
      setValidationWarnings([]);
      setShowValidationModal(false);
    } catch (err) {
      console.error("handleAssign error", err);
      setError(err instanceof Error ? err.message : 'Schicht konnte nicht zugewiesen werden.');
    }
  };

  const handleRemove = async (assignmentId: string) => {
    setActiveCell(null);
    try {
      await api.assignments.delete(assignmentId);
      fetchData(false);
    } catch (err) {
      console.error("handleRemove error", err);
      setError(err instanceof Error ? err.message : 'Schicht konnte nicht entfernt werden.');
    }
  };

  const toggleCell = (empId: string, dateStr: string) => {
    if (activeCell && activeCell.empId === empId && activeCell.dateStr === dateStr) {
      setActiveCell(null);
    } else {
      setActiveCell({ empId, dateStr });
    }
  };

  const getEmployeeName = (e: Employee) => {
    const parts = [e.first_name, e.last_name].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : e.email;
  };

  const sundayStr = formatDateDE(days[6]);
  const mondayStr = formatDateDE(days[0]);

  // Active shift types for assignment dropdown
  const activeShiftTypes = shiftTypes.filter((st) => st.is_active);

  const getTargetHours = (emp: Employee) => {
    return emp.weekly_hours;
  };

  const calculateEmpStats = (emp: Employee) => {
    let shifts = 0;
    let hours = 0;
    let vacations = 0;

    for (const d of days) {
      const dateStr = toISODateString(d);
      const ass = assignmentLookup[`${emp.id}|${dateStr}`];
      if (ass) {
        const st = shiftTypeMap[ass.shift_type_id];
        if (st) {
          shifts++;
          hours += getShiftDurationHours(st);
        }
      }
      if (vacationLookup.has(`${emp.id}|${dateStr}`)) {
        vacations++;
      }
    }
    return { shifts, hours, vacations };
  };

  return (
    <div className="animate-fade-in" style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      {/* ── Week Navigation ── */}
      <div
        className="glass-card"
        style={{
          padding: 'var(--space-md) var(--space-lg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--space-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <button className="btn btn-ghost btn-icon no-print" onClick={goToPrevWeek} title="Vorherige Woche">
            ←
          </button>
          <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)', minWidth: 220, textAlign: 'center' }}>
            KW {weekNumber} ({mondayStr} – {sundayStr})
          </span>
          <button className="btn btn-ghost btn-icon no-print" onClick={goToNextWeek} title="Nächste Woche">
            →
          </button>
        </div>
        <div className="no-print" style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={openAutoModal}
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            🪄 {t('shiftPlan.autoSchedule', 'Automatisch besetzen')}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleExportCSV}
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            📥 CSV Export
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => window.print()}
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            🖨️ Drucken
          </button>
          <button className="btn btn-secondary btn-sm" onClick={goToToday}>
            {t('shiftPlan.today', 'Heute')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/shift-plan/month')}
          >
            📅 {t('shiftPlan.monthView', 'Monatsansicht')}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: 'var(--danger-bg)', color: 'var(--danger)', padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="glass-card" style={{ padding: 'var(--space-2xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton-row" style={{ height: 48, borderRadius: 'var(--radius-sm)' }} />
          ))}
        </div>
      )}

      {/* Print-only Header */}
      {!loading && (
        <div className="print-only-header" style={{ marginBottom: 'var(--space-md)' }}>
          <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#000' }}>
            Dienstplan KW {weekNumber} ({mondayStr} - {sundayStr})
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#333' }}>
            Betrieb: <strong>{tenantName}</strong> | Stand: {new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} Uhr
          </p>
        </div>
      )}

      {/* ── Grid ── */}
      {!loading && (
        <div
          className="glass-card"
          style={{
            padding: 0,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              overflowX: 'auto',
              position: 'relative',
            }}
          >
            <table
              className="week-plan-table"
              style={{
                width: '100%',
                minWidth: 900,
                borderCollapse: 'separate',
                borderSpacing: 0,
              }}
            >
              {/* Header */}
              <thead>
                <tr>
                  <th
                    style={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 3,
                      background: 'var(--bg-elevated)',
                      minWidth: 160,
                      padding: 'var(--space-sm) var(--space-md)',
                      textAlign: 'left',
                      color: 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '2px solid var(--border-primary)',
                    }}
                  >
                    {t('shiftPlan.employee', 'Mitarbeiter')}
                  </th>
                  {days.map((day, idx) => {
                    const dateStr = toISODateString(day);
                    const isToday = dateStr === todayStr;
                    const isWeekend = idx >= 5;
                    return (
                      <th
                        key={dateStr}
                        style={{
                          padding: 'var(--space-sm) var(--space-md)',
                          textAlign: 'center',
                          color: isToday ? 'var(--accent)' : isWeekend ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          borderBottom: '2px solid var(--border-primary)',
                          background: isToday ? 'var(--accent-subtle)' : 'transparent',
                          minWidth: 110,
                        }}
                      >
                        {DAY_LABELS[idx]} {formatDateDE(day)}
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* Body */}
              <tbody>
                {employees.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: 'var(--space-2xl)',
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {t('shiftPlan.noEmployees', 'Keine aktiven Mitarbeiter vorhanden.')}
                    </td>
                  </tr>
                )}
                {employees.map((emp) => (
                  <tr key={emp.id}>
                    {/* Employee Name (sticky) */}
                    <td
                      style={{
                        position: 'sticky',
                        left: 0,
                        zIndex: 2,
                        background: 'var(--bg-elevated)',
                        padding: 'var(--space-sm) var(--space-md)',
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        fontSize: '0.9rem',
                        borderBottom: '1px solid var(--border-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 200,
                      }}
                    >
                      {getEmployeeName(emp)}
                    </td>

                    {/* Day cells */}
                    {days.map((day, idx) => {
                      const dateStr = toISODateString(day);
                      const isToday = dateStr === todayStr;
                      const key = `${emp.id}|${dateStr}`;
                      const assignment = assignmentLookup[key];
                      const isVacation = vacationLookup.has(key);
                      const isBlocked = blockedLookup.has(key);
                      const isWeekend = idx >= 5;
                      const isCellActive = activeCell?.empId === emp.id && activeCell?.dateStr === dateStr;
                      const st = assignment ? shiftTypeMap[assignment.shift_type_id] : null;

                      return (
                        <td
                          key={dateStr}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isBlocked) toggleCell(emp.id, dateStr);
                          }}
                          style={{
                            padding: 'var(--space-xs) var(--space-sm)',
                            borderBottom: '1px solid var(--border-primary)',
                            background: isBlocked
                              ? 'var(--bg-tertiary)'
                              : isVacation
                                ? undefined
                                : isToday
                                  ? 'var(--accent-subtle)'
                                  : isWeekend
                                    ? 'rgba(255,255,255,0.02)'
                                    : 'transparent',
                            position: 'relative',
                            zIndex: isCellActive ? 10 : undefined,
                            textAlign: 'center',
                            cursor: isBlocked ? 'not-allowed' : 'pointer',
                            height: 48,
                            verticalAlign: 'middle',
                            transition: 'var(--transition-fast)',
                          }}
                        >
                          {/* Vacation hatch overlay */}
                          {isVacation && (
                            <div
                              style={{
                                position: 'absolute',
                                inset: 0,
                                background: `repeating-linear-gradient(
                                  45deg,
                                  transparent,
                                  transparent 5px,
                                  rgba(34,197,94,0.12) 5px,
                                  rgba(34,197,94,0.12) 10px
                                )`,
                                pointerEvents: 'none',
                                zIndex: 0,
                              }}
                            />
                          )}

                          {/* Blocked overlay */}
                          {isBlocked && (
                            <div
                              style={{
                                position: 'absolute',
                                inset: 0,
                                background: 'rgba(0,0,0,0.3)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--text-muted)',
                                fontSize: '1rem',
                                fontWeight: 700,
                                zIndex: 1,
                              }}
                            >
                              ✕
                            </div>
                          )}

                          {/* Assignment chip */}
                          {assignment && st && !isBlocked && (
                            <div
                              className="shift-badge"
                              style={{
                                position: 'relative',
                                zIndex: 1,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '4px 10px',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: `${st.color}22`,
                                border: `1.5px solid ${st.color}`,
                                color: st.color,
                                fontWeight: 600,
                                fontSize: '0.8rem',
                                whiteSpace: 'nowrap',
                                boxShadow: `0 0 6px ${st.color}33`,
                              }}
                            >
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  backgroundColor: st.color,
                                  flexShrink: 0,
                                }}
                              />
                              <span className="shift-badge-name">{st.name}</span>
                            </div>
                          )}

                          {/* Vacation badge */}
                          {isVacation && !assignment && !isBlocked && (
                            <span className="badge badge-success" style={{ position: 'relative', zIndex: 1, fontSize: '0.7rem' }}>
                              🌴 Urlaub
                            </span>
                          )}


                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Live Metrics Summary Section */}
      {!loading && (
        <div className="glass-card no-print" style={{ padding: 'var(--space-md) var(--space-lg)', marginTop: 'var(--space-md)' }}>
          <details>
            <summary style={{ fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}>
              📊 Live-Zusammenfassung &amp; Arbeitszeit-Auswertung
            </summary>
            
            <div style={{ marginTop: 'var(--space-md)', overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '8px 12px', fontWeight: 600 }}>Mitarbeiter</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Geplante Schichten</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Urlaubstage</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Ist-Stunden (Netto)</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Soll-Stunden</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Differenz</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => {
                    const stats = calculateEmpStats(emp);
                    const targetHours = getTargetHours(emp);
                    const diff = stats.hours - targetHours;
                    const diffColor = diff === 0 ? 'var(--success)' : diff > 0 ? 'var(--warning)' : 'var(--text-muted)';
                    
                    return (
                      <tr key={emp.id} style={{ borderBottom: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 500 }}>{getEmployeeName(emp)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>{stats.shifts} Schicht(en)</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>{stats.vacations} Tag(e)</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>{stats.hours.toFixed(1)} Std.</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>{targetHours.toFixed(1)} Std.</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: diffColor }}>
                          {diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)} Std.
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {/* Print-only Legend */}
      {!loading && (
        <div className="print-only-legend" style={{ marginTop: 'var(--space-md)', borderTop: '1px solid #333', paddingTop: 'var(--space-sm)' }}>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '0.75rem', color: '#000', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Schicht-Legende:
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px' }}>
            {shiftTypes.map((st) => (
              <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: '#000' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: st.color, display: 'inline-block' }} />
                <strong>{st.name}</strong> ({st.start_time.substring(0, 5)} - {st.end_time.substring(0, 5)})
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Print-only Summary Table */}
      {!loading && (
        <div className="print-only-summary">
          <h4 style={{ margin: '0 0 6px 0', fontSize: '0.75rem', color: '#000', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Zusammenfassung geplante Stunden:
          </h4>
          <table>
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th>Geplante Schichten</th>
                <th>Urlaubstage</th>
                <th>Ist-Stunden (Netto)</th>
                <th>Soll-Stunden</th>
                <th>Differenz</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => {
                const stats = calculateEmpStats(emp);
                const targetHours = getTargetHours(emp);
                const diff = stats.hours - targetHours;
                return (
                  <tr key={emp.id}>
                    <td>{getEmployeeName(emp)}</td>
                    <td>{stats.shifts} Schicht(en)</td>
                    <td>{stats.vacations} Tag(e)</td>
                    <td>{stats.hours.toFixed(1)} Std.</td>
                    <td>{targetHours.toFixed(1)} Std.</td>
                    <td>
                      {diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)} Std.
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Color Legend ── */}
      {!loading && shiftTypes.length > 0 && (
        <div
          className="glass-card no-print"
          style={{
            padding: 'var(--space-md) var(--space-lg)',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--space-md)',
          }}
        >
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
            {t('shiftPlan.legend', 'Legende')}:
          </span>
          {shiftTypes.map((st) => (
            <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: st.color,
                  boxShadow: `0 0 6px ${st.color}55`,
                }}
              />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                {st.name}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'var(--space-sm)' }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, background: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(34,197,94,0.25) 2px, rgba(34,197,94,0.25) 4px)' }} />
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Urlaub</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: '#aaa', lineHeight: 1 }}>✕</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Gesperrt</span>
          </div>
        </div>
      )}

      {/* Click-away listener */}
      {activeCell && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1,
          }}
          onClick={() => setActiveCell(null)}
        />
      )}

      {/* ── Validation Warnings Modal ── */}
      {showValidationModal && (
        <div className="modal-backdrop" onClick={() => setShowValidationModal(false)}>
          <div
            className="modal animate-slide-up"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 460, width: '100%' }}
          >
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                ⚠️ {t('shiftPlan.validationWarningsTitle', 'Planungskonflikt')}
              </h2>
            </div>
            
            <div style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                {t('shiftPlan.validationWarningsText', 'Die geplante Zuweisung verletzt folgende Planungsrichtlinien:')}
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                {validationWarnings.map((warning, index) => {
                  const isCritical = warning.severity === 'Critical';
                  return (
                    <div
                      key={index}
                      style={{
                        background: isCritical ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                        border: `1px solid ${isCritical ? 'var(--danger)' : 'var(--warning)'}`,
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-sm) var(--space-md)',
                        color: isCritical ? 'var(--danger)' : 'var(--warning)',
                        fontSize: '0.9rem',
                        lineHeight: 1.4,
                        textAlign: 'left',
                      }}
                    >
                      <strong>{isCritical ? 'Kritisch: ' : 'Warnung: '}</strong>
                      {warning.message_de}
                    </div>
                  );
                })}
              </div>
              
              <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                Möchten Sie die Zuweisung trotzdem durchführen?
              </p>
            </div>
            
            <div className="modal-footer">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setShowValidationModal(false);
                  setProposedAssignment(null);
                  setValidationWarnings([]);
                }}
              >
                {t('common.cancel', 'Abbrechen')}
              </button>
              <button
                className="btn btn-primary"
                style={{
                  background: validationWarnings.some(w => w.severity === 'Critical') ? 'var(--danger)' : 'var(--accent)',
                }}
                onClick={() => {
                  if (proposedAssignment) {
                    handleAssign(
                      proposedAssignment.employeeId,
                      proposedAssignment.dateStr,
                      proposedAssignment.shiftTypeId,
                      true
                    );
                  }
                }}
              >
                {t('shiftPlan.assignAnyway', 'Trotzdem zuweisen')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Auto Schedule Modal ── */}
      {showAutoModal && (
        <div className="modal-backdrop" onClick={() => !autoScheduling && setShowAutoModal(false)}>
          <div
            className="modal animate-slide-up"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 440, width: '100%' }}
          >
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                🪄 Automatische Dienstplanbesetzung
              </h2>
              <button className="btn btn-ghost btn-icon" type="button" onClick={() => setShowAutoModal(false)} disabled={autoScheduling}>✕</button>
            </div>

            <form onSubmit={handleAutoSchedule}>
              <div style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                
                <div className="glass-card" style={{
                  padding: 'var(--space-md)',
                  background: 'rgba(235, 94, 40, 0.05)',
                  borderColor: 'rgba(235, 94, 40, 0.3)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.85rem',
                  lineHeight: '1.4',
                }}>
                  ⚠️ <strong>Achtung:</strong> Bereits geplante Schichten im ausgewählten Zukunftszeitraum werden überschrieben. Dienstpläne in der Vergangenheit werden nicht verändert.
                </div>

                {autoScheduleError && (
                  <div style={{ color: 'var(--danger)', fontSize: '0.9rem', fontWeight: 500 }}>
                    ❌ {autoScheduleError}
                  </div>
                )}

                <div className="form-group">
                  <label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)', display: 'block' }}>
                    Startdatum (ab) *
                  </label>
                  <input
                    type="date"
                    className="input"
                    required
                    min={todayStr}
                    value={autoStartDate}
                    onChange={(e) => setAutoStartDate(e.target.value)}
                    disabled={autoScheduling}
                  />
                </div>

                <div className="form-group">
                  <label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)', display: 'block' }}>
                    Enddatum (bis) *
                  </label>
                  <input
                    type="date"
                    className="input"
                    required
                    min={autoStartDate || todayStr}
                    value={autoEndDate}
                    onChange={(e) => setAutoEndDate(e.target.value)}
                    disabled={autoScheduling}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowAutoModal(false)} disabled={autoScheduling}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary" disabled={autoScheduling || !autoStartDate || !autoEndDate}>
                  {autoScheduling ? 'Generiere…' : 'Dienstplan besetzen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Assign Shift Modal ── */}
      {activeCell && (
        <div
          className="modal-backdrop"
          onClick={() => setActiveCell(null)}
          style={{ zIndex: 'var(--z-modal-backdrop)' }}
        >
          <div
            className="modal animate-slide-up"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 360, width: '100%' }}
          >
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                Schicht planen
              </h3>
              <button
                className="btn btn-ghost btn-icon"
                type="button"
                onClick={() => setActiveCell(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div className="form-group">
                <label className="label" style={{ marginBottom: 2 }}>Mitarbeiter</label>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                  {(() => {
                    const emp = employees.find(e => e.id === activeCell.empId);
                    return emp ? getEmployeeName(emp) : '';
                  })()}
                </div>
              </div>

              <div className="form-group">
                <label className="label" style={{ marginBottom: 2 }}>Datum</label>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                  {(() => {
                    const parts = activeCell.dateStr.split('-');
                    return `${parts[2]}.${parts[1]}.${parts[0]}`;
                  })()}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                <label className="label" style={{ marginBottom: 2 }}>Schicht auswählen</label>
                {activeShiftTypes.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '10px' }}>
                    Keine aktiven Schichttypen vorhanden.
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: 240, overflowY: 'auto', paddingRight: 4 }}>
                  {activeShiftTypes.map((sType) => (
                    <button
                      key={sType.id}
                      className="btn btn-ghost"
                      type="button"
                      style={{
                        width: '100%',
                        justifyContent: 'flex-start',
                        gap: 12,
                        textAlign: 'left',
                        padding: '10px 14px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-primary)',
                        borderRadius: 'var(--radius-sm)',
                        minHeight: 52,
                      }}
                      onClick={() => handleAssign(activeCell.empId, activeCell.dateStr, sType.id)}
                    >
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          backgroundColor: sType.color,
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{sType.name}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          {sType.start_time.substring(0, 5)} - {sType.end_time.substring(0, 5)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Remove Option */}
                {(() => {
                  const ass = assignmentLookup[`${activeCell.empId}|${activeCell.dateStr}`];
                  return ass ? (
                    <button
                      className="btn btn-danger"
                      type="button"
                      style={{
                        width: '100%',
                        marginTop: 'var(--space-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        minHeight: 38,
                      }}
                      onClick={() => handleRemove(ass.id)}
                    >
                      🗑️ Schicht entfernen
                    </button>
                  ) : null;
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
