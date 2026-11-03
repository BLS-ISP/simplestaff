import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ValidationWarning } from '../api/client';
import type { Employee, ShiftType, ShiftAssignment, Vacation, BlockedDay, WeekTemplate } from '../types';
import { useAuth } from '../hooks/useAuth';

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

function getAssignmentDurationHours(ass: ShiftAssignment, st: ShiftType): number {
  if (ass.status === 'sick') return 0;
  const startStr = ass.actual_start || st.start_time;
  const endStr = ass.actual_end || st.end_time;
  const breakMins = ass.actual_break_minutes ?? st.break_minutes;

  const [sH, sM] = startStr.split(':').map(Number);
  const [eH, eM] = endStr.split(':').map(Number);

  let startMinutes = sH * 60 + sM;
  let endMinutes = eH * 60 + eM;

  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }

  const totalMinutes = endMinutes - startMinutes - breakMins;
  return Math.max(0, totalMinutes / 60);
}

const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// ── Component ─────────────────────────────────────────────────

export default function ShiftPlanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isViewer = (user?.role || 'viewer') === 'viewer';

  const [currentMonday, setCurrentMonday] = useState(() => getMonday(new Date()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [vacationMap, setVacationMap] = useState<Record<string, Vacation[]>>({});
  const [blockedMap, setBlockedMap] = useState<Record<string, BlockedDay[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>('');
  const [onlyMyShifts, setOnlyMyShifts] = useState(false);
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState('');
  const [onlyScheduledThisWeek, setOnlyScheduledThisWeek] = useState(false);

  // Dropdown state for assigning shifts
  const [activeCell, setActiveCell] = useState<{ empId: string; dateStr: string } | null>(null);
  const [editStatus, setEditStatus] = useState<string>('planned');
  const [editActualStart, setEditActualStart] = useState<string>('');
  const [editActualEnd, setEditActualEnd] = useState<string>('');
  const [editActualBreak, setEditActualBreak] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [copyingWeek, setCopyingWeek] = useState(false);

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

  // Week templates state (Feature 5)
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [templates, setTemplates] = useState<WeekTemplate[]>([]);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);

  // Multi-day sick leave state (Feature 2)
  const [showSickRangeModal, setShowSickRangeModal] = useState(false);
  const [sickRangeEmpId, setSickRangeEmpId] = useState('');
  const [sickRangeStart, setSickRangeStart] = useState('');
  const [sickRangeEnd, setSickRangeEnd] = useState('');
  const [sickRangeNotes, setSickRangeNotes] = useState('');
  const [submittingSickRange, setSubmittingSickRange] = useState(false);

  const openTemplatesModal = async () => {
    setShowTemplatesModal(true);
    try {
      const list = await api.assignments.listTemplates();
      setTemplates(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vorlagen konnten nicht geladen werden.');
    }
  };

  const handleSaveWeekTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) return;
    try {
      setSavingTemplate(true);
      setError(null);
      const created = await api.assignments.createTemplate({
        name: newTemplateName.trim(),
        source_monday: toISODateString(currentMonday),
      });
      setTemplates((prev) => [...prev, created]);
      setNewTemplateName('');
      setInfoMessage(`Wochen-Vorlage "${created.name}" (${created.entries.length} Schichten) gespeichert.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vorlage konnte nicht gespeichert werden.');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleApplyWeekTemplate = async (tpl: WeekTemplate) => {
    if (!window.confirm(`Vorlage "${tpl.name}" auf die aktuelle Woche (KW ${weekNumber}) anwenden?`)) return;
    try {
      setApplyingTemplateId(tpl.id);
      setError(null);
      const res = await api.assignments.applyTemplate(tpl.id, toISODateString(currentMonday));
      setShowTemplatesModal(false);
      setInfoMessage(`Vorlage "${tpl.name}" angewendet: ${res.applied_count} Schicht(en) eingetragen (${res.skipped_count} übersprungen).`);
      await fetchData(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vorlage konnte nicht angewendet werden.');
    } finally {
      setApplyingTemplateId(null);
    }
  };

  const handleDeleteWeekTemplate = async (id: string) => {
    if (!window.confirm('Diese Wochen-Vorlage wirklich löschen?')) return;
    try {
      await api.assignments.deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  };

  const openSickRangeModal = () => {
    setSickRangeStart(toISODateString(currentMonday));
    const sun = new Date(currentMonday);
    sun.setDate(sun.getDate() + 6);
    setSickRangeEnd(toISODateString(sun));
    setSickRangeNotes('');
    setShowSickRangeModal(true);
  };

  const handleSickRangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sickRangeStart || !sickRangeEnd) return;
    if (!isViewer && !sickRangeEmpId) {
      setError('Bitte wählen Sie einen Mitarbeiter aus.');
      return;
    }
    try {
      setSubmittingSickRange(true);
      setError(null);
      const res = await api.assignments.markSickRange({
        employee_id: isViewer ? undefined : sickRangeEmpId,
        start_date: sickRangeStart,
        end_date: sickRangeEnd,
        notes: sickRangeNotes.trim() || undefined,
      });
      setShowSickRangeModal(false);
      setInfoMessage(
        `Krankmeldung gespeichert: ${res.marked_sick_count} Schicht(en) als krank markiert (${res.swap_requests_created} Vertretungsgesuch(e) geöffnet).`
      );
      await fetchData(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Krankmeldung fehlgeschlagen.');
    } finally {
      setSubmittingSickRange(false);
    }
  };

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

  // Build assignment lookup: `empId|date` → ShiftAssignment (prioritizing active non-sick shifts)
  const assignmentLookup = useMemo(() => {
    const map: Record<string, ShiftAssignment> = {};
    for (const a of assignments) {
      const key = `${a.employee_id}|${a.assignment_date}`;
      const existing = map[key];
      if (!existing || existing.status === 'sick' || a.status !== 'sick') {
        map[key] = a;
      }
    }
    return map;
  }, [assignments]);

  // Build vacation lookup: `empId|date` → true
  const vacationLookup = useMemo(() => {
    const set = new Set<string>();
    for (const [empId, vacs] of Object.entries(vacationMap)) {
      for (const v of vacs) {
        if (v.status !== 'approved') continue;
        // Parse YYYY-MM-DD in local time to prevent UTC timezone offset issues
        const [sy, sm, sd] = v.start_date.split('-').map(Number);
        const [ey, em, ed] = v.end_date.split('-').map(Number);
        const start = new Date(sy, (sm || 1) - 1, sd || 1);
        const end = new Date(ey, (em || 1) - 1, ed || 1);
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

      // Fetch vacations + blocked days (for viewer only own employee to avoid 403)
      const targetEmps = isViewer
        ? emps.filter((e: Employee) => e.email && user?.email && e.email.toLowerCase() === user.email.toLowerCase())
        : emps;

      const vacPromises = targetEmps.map((e: Employee) =>
        api.vacations.list(e.id).then((v) => [e.id, v] as const).catch(() => [e.id, []] as const)
      );
      const blockPromises = targetEmps.map((e: Employee) =>
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
  }, [currentMonday, t, isViewer, user?.email]);

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
  const handleCopyPreviousWeek = async () => {
    const prevMonday = new Date(currentMonday);
    prevMonday.setDate(prevMonday.getDate() - 7);
    if (!confirm('Schichten der Vorwoche in die aktuelle Woche kopieren? (Urlaubs-, Sperr- und Schließtage werden automatisch übersprungen)')) {
      return;
    }
    try {
      setCopyingWeek(true);
      setError(null);
      setInfoMessage(null);
      const res = await api.assignments.copyWeek({
        source_monday: toISODateString(prevMonday),
        target_monday: toISODateString(currentMonday),
      });
      setInfoMessage(`${res.copied_count} Schichten aus der Vorwoche kopiert (${res.skipped_count} übersprungen).`);
      await fetchData(false);
      setTimeout(() => setInfoMessage(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vorwoche konnte nicht kopiert werden.');
    } finally {
      setCopyingWeek(false);
    }
  };

  const handleSaveAssignmentDetails = async (assignmentId: string) => {
    try {
      setSavingDetails(true);
      setError(null);
      const formatTimeForApi = (val: string) => {
        if (!val) return undefined;
        return val.length === 5 ? `${val}:00` : val;
      };
      await api.assignments.update(assignmentId, {
        status: editStatus,
        actual_start: formatTimeForApi(editActualStart),
        actual_end: formatTimeForApi(editActualEnd),
        actual_break_minutes: editActualBreak !== '' ? parseInt(editActualBreak, 10) : undefined,
        notes: editNotes,
      });
      setActiveCell(null);
      await fetchData(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Details konnten nicht gespeichert werden.');
    } finally {
      setSavingDetails(false);
    }
  };

  const handleMarkSick = async (assignmentId: string) => {
    try {
      setSavingDetails(true);
      setError(null);
      await api.assignments.markSick(assignmentId);
      setActiveCell(null);
      setInfoMessage('Mitarbeiter als krank markiert und offene Vertretungsanfrage in der Tauschbörse erstellt.');
      await fetchData(false);
      setTimeout(() => setInfoMessage(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Krankmeldung fehlgeschlagen.');
    } finally {
      setSavingDetails(false);
    }
  };

  const handleAssign = async (employeeId: string, dateStr: string, shiftTypeId: string, force: boolean = false) => {
    const existingAss = assignmentLookup[`${employeeId}|${dateStr}`];
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

      if (existingAss) {
        await api.assignments.update(existingAss.id, {
          shift_type_id: shiftTypeId,
        });
      } else {
        await api.assignments.create({
          employee_id: employeeId,
          shift_type_id: shiftTypeId,
          assignment_date: dateStr,
        });
      }
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
    if (isViewer) return;
    if (activeCell && activeCell.empId === empId && activeCell.dateStr === dateStr) {
      setActiveCell(null);
    } else {
      const existing = assignmentLookup[`${empId}|${dateStr}`];
      if (existing) {
        const st = shiftTypeMap[existing.shift_type_id];
        setEditStatus(existing.status || 'planned');
        setEditActualStart(existing.actual_start ? existing.actual_start.substring(0, 5) : st ? st.start_time.substring(0, 5) : '');
        setEditActualEnd(existing.actual_end ? existing.actual_end.substring(0, 5) : st ? st.end_time.substring(0, 5) : '');
        setEditActualBreak(existing.actual_break_minutes != null ? String(existing.actual_break_minutes) : st ? String(st.break_minutes) : '0');
        setEditNotes(existing.notes || '');
      } else {
        setEditStatus('planned');
        setEditActualStart('');
        setEditActualEnd('');
        setEditActualBreak('');
        setEditNotes('');
      }
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

  const calculateEmpStats = useCallback((emp: Employee) => {
    let shifts = 0;
    let hours = 0;
    let vacations = 0;

    for (const d of days) {
      const dateStr = toISODateString(d);
      const ass = assignmentLookup[`${emp.id}|${dateStr}`];
      if (ass) {
        const st = shiftTypeMap[ass.shift_type_id];
        if (st && ass.status !== 'sick') {
          shifts++;
          hours += getAssignmentDurationHours(ass, st);
        }
      }
      if (vacationLookup.has(`${emp.id}|${dateStr}`)) {
        vacations++;
      }
    }
    return { shifts, hours, vacations };
  }, [days, assignmentLookup, shiftTypeMap, vacationLookup]);

  const displayedEmployees = useMemo(() => {
    let list = employees;
    if (isViewer && onlyMyShifts && user) {
      list = list.filter(
        (e) =>
          (e.user_id && e.user_id === user.id) ||
          (user.employee_id && e.id === user.employee_id) ||
          (user.email && e.email?.toLowerCase() === user.email.toLowerCase())
      );
    }
    const q = employeeSearchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((e) => {
        const fullName = `${e.first_name || ''} ${e.last_name || ''} ${e.email || ''}`.toLowerCase();
        return fullName.includes(q);
      });
    }
    if (onlyScheduledThisWeek) {
      list = list.filter((e) => calculateEmpStats(e).shifts > 0);
    }
    return list;
  }, [employees, isViewer, onlyMyShifts, user, employeeSearchQuery, onlyScheduledThisWeek, calculateEmpStats]);

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
          {isViewer ? (
            <button
              className={`btn btn-sm ${onlyMyShifts ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setOnlyMyShifts(!onlyMyShifts)}
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              {onlyMyShifts ? '👤 Nur meine Schichten' : '👥 Gesamtes Team'}
            </button>
          ) : (
            <>
              <button
                className="btn btn-primary btn-sm"
                onClick={openAutoModal}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                🪄 {t('shiftPlan.autoSchedule', 'Automatisch besetzen')}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleCopyPreviousWeek}
                disabled={copyingWeek}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                title="Kopiert die Schichten der Vorwoche in diese Woche"
              >
                📋 {copyingWeek ? 'Kopiere…' : 'Vorwoche kopieren'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={openTemplatesModal}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                title="Wochen-Vorlagen speichern oder auf diese Woche anwenden"
              >
                🗂️ Vorlagen
              </button>
            </>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={openSickRangeModal}
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            title="Mehrtagige Krankmeldung (Zeitraum von–bis) eintragen"
          >
            🤒 Krankmeldung
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

      {/* Error / Info */}
      {error && (
        <div style={{ background: 'var(--danger-bg)', color: 'var(--danger)', padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {infoMessage && (
        <div style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.35)', color: '#10b981', padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>✅ {infoMessage}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setInfoMessage(null)}>✕</button>
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
                      minWidth: 210,
                      padding: 'var(--space-sm) var(--space-md)',
                      textAlign: 'left',
                      color: 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      borderBottom: '2px solid var(--border-primary)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {t('shiftPlan.employee', 'Mitarbeiter')} ({displayedEmployees.length})
                      </span>
                      <button
                        type="button"
                        className="no-print"
                        onClick={() => setOnlyScheduledThisWeek(!onlyScheduledThisWeek)}
                        title="Nur Mitarbeiter anzeigen, die in dieser Woche Schichten haben"
                        style={{
                          background: onlyScheduledThisWeek ? 'rgba(99, 102, 241, 0.25)' : 'rgba(148, 163, 184, 0.1)',
                          color: onlyScheduledThisWeek ? '#a5b4fc' : 'var(--text-tertiary)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: 4,
                          fontSize: '0.68rem',
                          padding: '1px 6px',
                          cursor: 'pointer',
                        }}
                      >
                        {onlyScheduledThisWeek ? '✓ Eingeplant' : 'Alle'}
                      </button>
                    </div>
                    <input
                      type="text"
                      className="input no-print"
                      placeholder="🔍 Mitarbeiter filtern..."
                      value={employeeSearchQuery}
                      onChange={(e) => setEmployeeSearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        height: 28,
                      }}
                    />
                  </th>
                  {days.map((day, idx) => {
                    const dateStr = toISODateString(day);
                    const isToday = dateStr === todayStr;
                    const isWeekend = idx >= 5;
                    const dayAssignments = assignments.filter(
                      (a) => a.assignment_date === dateStr && a.status !== 'sick'
                    );
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
                          minWidth: 115,
                        }}
                      >
                        <div>{DAY_LABELS[idx]} {formatDateDE(day)}</div>
                        <div style={{
                          marginTop: 4,
                          fontSize: '0.68rem',
                          fontWeight: 600,
                          textTransform: 'none',
                          color: dayAssignments.length > 0 ? '#10b981' : 'var(--text-tertiary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}>
                          <span>👥 {dayAssignments.length}</span>
                          {dayAssignments.slice(0, 5).map((da) => {
                            const st = shiftTypeMap[da.shift_type_id];
                            return st ? (
                              <span
                                key={da.id}
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  background: st.color,
                                  display: 'inline-block',
                                }}
                                title={st.name}
                              />
                            ) : null;
                          })}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* Body */}
              <tbody>
                {displayedEmployees.length === 0 && (
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
                {displayedEmployees.map((emp) => {
                  const isOwnRow =
                    isViewer &&
                    user &&
                    ((emp.user_id && emp.user_id === user.id) ||
                      (user.employee_id && emp.id === user.employee_id) ||
                      (user.email && emp.email?.toLowerCase() === user.email.toLowerCase()));
                  const empWeekStats = calculateEmpStats(emp);
                  const targetHrs = getTargetHours(emp);
                  const isOverHours = targetHrs > 0 && empWeekStats.hours > targetHrs;
                  return (
                  <tr key={emp.id} style={isOwnRow ? { background: 'rgba(99, 102, 241, 0.06)' } : undefined}>
                    {/* Employee Name (sticky) */}
                    <td
                      style={{
                        position: 'sticky',
                        left: 0,
                        zIndex: 2,
                        background: 'var(--bg-elevated)',
                        padding: 'var(--space-sm) var(--space-md)',
                        fontWeight: isOwnRow ? 700 : 500,
                        color: isOwnRow ? 'var(--accent)' : 'var(--text-primary)',
                        fontSize: '0.9rem',
                        borderBottom: '1px solid var(--border-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 220,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {getEmployeeName(emp)} {isOwnRow ? '(Ich)' : ''}
                        </span>
                        {emp.shift_preferences?._protection_profile === 'youth' && (
                          <span title="JArbSchG (< 18 J.): Max. 8h/Tag, 12h Ruhezeit, 06–20 Uhr, So/Feiertag frei">🔞</span>
                        )}
                        {emp.shift_preferences?._protection_profile === 'youth_hospitality' && (
                          <span title="JArbSchG Gastro (§ 14 Abs. 2): Max. 8h/Tag, 12h Ruhezeit, 05–22 Uhr, jeder 2. So frei">🥐</span>
                        )}
                        {emp.shift_preferences?._protection_profile === 'maternity' && (
                          <span title="Mutterschutz (MuSchG): Max. 8,5h/Tag, 06–20 Uhr, mind. 11h Ruhezeit">🤰</span>
                        )}
                      </div>
                      <div style={{
                        fontSize: '0.72rem',
                        fontWeight: 500,
                        color: isOverHours ? '#f59e0b' : 'var(--text-tertiary)',
                        marginTop: 2,
                      }}>
                        ⏱️ {empWeekStats.hours.toFixed(1).replace(/\.0$/, '')} / {targetHrs} Std. ({empWeekStats.shifts} Sch.)
                      </div>
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
                      const isSick = assignment?.status === 'sick';
                      const hasActualTimes = Boolean(assignment?.actual_start && assignment?.actual_end);

                      return (
                        <td
                          key={dateStr}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isViewer && !isBlocked) toggleCell(emp.id, dateStr);
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
                            cursor: isViewer ? 'default' : isBlocked ? 'not-allowed' : 'pointer',
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
                              title={
                                isSick
                                  ? `Krankgemeldet (${st.name})`
                                  : hasActualTimes
                                    ? `Ist-Zeit: ${assignment.actual_start!.substring(0, 5)} - ${assignment.actual_end!.substring(0, 5)}`
                                    : `${st.name} (${st.start_time.substring(0, 5)} - ${st.end_time.substring(0, 5)})`
                              }
                              style={{
                                position: 'relative',
                                zIndex: 1,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '4px 10px',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: isSick ? 'rgba(239, 68, 68, 0.16)' : `${st.color}22`,
                                border: `1.5px ${isSick ? 'dashed #ef4444' : `solid ${st.color}`}`,
                                color: isSick ? '#ef4444' : st.color,
                                fontWeight: 600,
                                fontSize: '0.8rem',
                                whiteSpace: 'nowrap',
                                boxShadow: isSick ? 'none' : `0 0 6px ${st.color}33`,
                                textDecoration: isSick ? 'line-through' : 'none',
                              }}
                            >
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  backgroundColor: isSick ? '#ef4444' : st.color,
                                  flexShrink: 0,
                                }}
                              />
                              <span className="shift-badge-name">
                                {isSick ? `🤒 ${st.name}` : st.name}
                                {hasActualTimes && !isSick ? ' ✓' : ''}
                              </span>
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
                  );
                })}
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
            {shiftTypes
              .filter((st) => st.is_active || assignments.some((a) => a.shift_type_id === st.id))
              .map((st) => (
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
          {shiftTypes
            .filter((st) => st.is_active || assignments.some((a) => a.shift_type_id === st.id))
            .map((st) => (
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
                  const isCritical = warning.severity.toLowerCase() === 'critical';
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
                  background: validationWarnings.some(w => w.severity.toLowerCase() === 'critical') ? 'var(--danger)' : 'var(--accent)',
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

                {/* Edit Existing Assignment Details & Sick Leave */}
                {(() => {
                  const ass = assignmentLookup[`${activeCell.empId}|${activeCell.dateStr}`];
                  if (!ass) return null;
                  return (
                    <div
                      style={{
                        marginTop: 'var(--space-sm)',
                        paddingTop: 'var(--space-sm)',
                        borderTop: '1px solid var(--border-primary)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <label className="label" style={{ marginBottom: 0 }}>
                        ⏱️ Ist-Arbeitszeit &amp; Status erfassen
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 2 }}>
                            Status
                          </label>
                          <select
                            className="input"
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value)}
                            style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                          >
                            <option value="planned">Geplant</option>
                            <option value="confirmed">Bestätigt</option>
                            <option value="completed">✓ Abgeschlossen</option>
                            <option value="sick">🤒 Krank</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 2 }}>
                            Pause (Min.)
                          </label>
                          <input
                            type="number"
                            className="input"
                            min={0}
                            max={240}
                            value={editActualBreak}
                            onChange={(e) => setEditActualBreak(e.target.value)}
                            style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 2 }}>
                            Ist-Beginn
                          </label>
                          <input
                            type="time"
                            className="input"
                            value={editActualStart}
                            onChange={(e) => setEditActualStart(e.target.value)}
                            style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 2 }}>
                            Ist-Ende
                          </label>
                          <input
                            type="time"
                            className="input"
                            value={editActualEnd}
                            onChange={(e) => setEditActualEnd(e.target.value)}
                            style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                          />
                        </div>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 2 }}>
                          Notiz
                        </label>
                        <input
                          type="text"
                          className="input"
                          placeholder="Optionale Notiz..."
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                        />
                      </div>

                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        disabled={savingDetails}
                        onClick={() => handleSaveAssignmentDetails(ass.id)}
                        style={{ width: '100%' }}
                      >
                        💾 {savingDetails ? 'Speichere…' : 'Ist-Zeiten & Status speichern'}
                      </button>

                      {ass.status !== 'sick' && (
                        <button
                          className="btn btn-secondary btn-sm"
                          type="button"
                          disabled={savingDetails}
                          onClick={() => handleMarkSick(ass.id)}
                          style={{
                            width: '100%',
                            borderColor: 'rgba(245, 158, 11, 0.5)',
                            color: '#f59e0b',
                          }}
                        >
                          🤒 Krankmelden &amp; Vertretung suchen
                        </button>
                      )}

                      <button
                        className="btn btn-danger btn-sm"
                        type="button"
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                        }}
                        onClick={() => handleRemove(ass.id)}
                      >
                        🗑️ Schicht entfernen
                      </button>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Week Templates Modal (Feature 5) ── */}
      {showTemplatesModal && !isViewer && (
        <div className="modal-backdrop" onClick={() => setShowTemplatesModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <h3 style={{ margin: '0 0 var(--space-xs) 0', fontSize: '1.15rem', fontWeight: 700 }}>
              🗂️ Wochen-Vorlagen verwalten
            </h3>
            <p style={{ margin: '0 0 var(--space-md) 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Speichere die aktuell angezeigte Woche (KW {weekNumber}) als wiederverwendbare Musterwoche oder wende eine gespeicherte Vorlage auf KW {weekNumber} an.
            </p>

            <form onSubmit={handleSaveWeekTemplate} style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
              <input
                type="text"
                className="input"
                required
                placeholder="Name der Vorlage (z. B. Regelbetrieb, Ferienwoche)..."
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingTemplate}>
                {savingTemplate ? 'Speichert…' : '+ Aktuelle Woche speichern'}
              </button>
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', maxHeight: 280, overflowY: 'auto' }}>
              {templates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-lg)', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Noch keine Wochen-Vorlagen gespeichert.
                </div>
              ) : (
                templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 'var(--space-sm)',
                      padding: 'var(--space-sm) var(--space-md)',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.92rem' }}>{tpl.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {tpl.entries.length} Schichtzuweisungen gespeichert
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={applyingTemplateId === tpl.id}
                        onClick={() => handleApplyWeekTemplate(tpl)}
                      >
                        {applyingTemplateId === tpl.id ? 'Wende an…' : 'Auf KW ' + weekNumber + ' anwenden'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDeleteWeekTemplate(tpl.id)}
                        title="Vorlage löschen"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowTemplatesModal(false)}>
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Multi-Day Sick Leave Modal (Feature 2) ── */}
      {showSickRangeModal && (
        <div className="modal-backdrop" onClick={() => setShowSickRangeModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h3 style={{ margin: '0 0 var(--space-xs) 0', fontSize: '1.15rem', fontWeight: 700 }}>
              🤒 Krankmeldung für Zeitraum eintragen
            </h3>
            <p style={{ margin: '0 0 var(--space-md) 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Alle geplanten Schichten im gewählten Zeitraum werden automatisch als krank markiert und als Vertretungsgesuch in die Tauschbörse gestellt.
            </p>
            <form onSubmit={handleSickRangeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {!isViewer && (
                <div>
                  <label className="label">Mitarbeiter</label>
                  <select className="input" required value={sickRangeEmpId} onChange={(e) => setSickRangeEmpId(e.target.value)}>
                    <option value="">-- Mitarbeiter wählen --</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {getEmployeeName(emp)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                <div>
                  <label className="label">Krank von</label>
                  <input type="date" className="input" required value={sickRangeStart} onChange={(e) => setSickRangeStart(e.target.value)} />
                </div>
                <div>
                  <label className="label">Bis (inkl.)</label>
                  <input type="date" className="input" required value={sickRangeEnd} onChange={(e) => setSickRangeEnd(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notiz / Hinweis (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="z. B. AU liegt vor"
                  value={sickRangeNotes}
                  onChange={(e) => setSickRangeNotes(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowSickRangeModal(false)}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-danger btn-sm" disabled={submittingSickRange}>
                  {submittingSickRange ? 'Speichere…' : '🤒 Krankmeldung speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
