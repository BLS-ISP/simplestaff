import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import type { BlockedDay, ClosedDay, Employee, ShiftType, Vacation } from '../types';

interface VacationWithEmp extends Vacation {
  employee_name?: string;
}

type EmployeeSelfServiceTab = 'vacation' | 'blocked' | 'preferences' | 'sick';

const WEEKDAYS = [
  { key: 1, label: 'Montag' },
  { key: 2, label: 'Dienstag' },
  { key: 3, label: 'Mittwoch' },
  { key: 4, label: 'Donnerstag' },
  { key: 5, label: 'Freitag' },
  { key: 6, label: 'Samstag' },
  { key: 7, label: 'Sonntag' },
];

export default function VacationsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userRole = user?.role || 'viewer';
  const isEmployee = userRole === 'viewer';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Employee-specific state
  const [activeTab, setActiveTab] = useState<EmployeeSelfServiceTab>('vacation');
  const [currentEmp, setCurrentEmp] = useState<Employee | null>(null);
  const [myVacations, setMyVacations] = useState<Vacation[]>([]);
  const [myBlockedDays, setMyBlockedDays] = useState<BlockedDay[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [prefs, setPrefs] = useState<Record<string, number>>({});

  // Vacation form
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');

  // Blocked day form
  const [blockedDate, setBlockedDate] = useState('');
  const [blockedReason, setBlockedReason] = useState('');

  // Sick range form (Employee or Manager)
  const [sickEmpId, setSickEmpId] = useState('');
  const [sickStart, setSickStart] = useState('');
  const [sickEnd, setSickEnd] = useState('');
  const [sickNotes, setSickNotes] = useState('');
  const [showManagerSickModal, setShowManagerSickModal] = useState(false);

  // Manager-specific state
  const [allVacations, setAllVacations] = useState<VacationWithEmp[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [closedDays, setClosedDays] = useState<ClosedDay[]>([]);

  useEffect(() => {
    fetchData();
  }, [userRole]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const closedRes = await api.closedDays.list().catch(() => [] as ClosedDay[]);
      setClosedDays(closedRes);

      if (isEmployee) {
        const [emp, sts] = await Promise.all([
          api.employees.getMe(),
          api.shiftTypes.list().catch(() => [] as ShiftType[]),
        ]);
        setCurrentEmp(emp);
        setPrefs({ ...(emp.shift_preferences || {}) });
        setShiftTypes(sts);

        const [vacs, bds] = await Promise.all([
          api.vacations.list(emp.id),
          api.blockedDays.list(emp.id).catch(() => [] as BlockedDay[]),
        ]);
        setMyVacations(vacs);
        setMyBlockedDays(bds);
      } else {
        const [vacs, empRes] = await Promise.all([
          api.vacations.listAll(),
          api.employees.list({ is_active: true, per_page: 200 }),
        ]);
        setAllVacations(vacs);
        setAllEmployees(empRes.data);
      }
    } catch (err) {
      console.error('Error fetching vacations data:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Urlaubsdaten.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestVacation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEmp) return;
    if (!startDate || !endDate) {
      setError('Start- und Enddatum sind erforderlich.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setSuccessMsg(null);
      await api.vacations.create(currentEmp.id, {
        start_date: startDate,
        end_date: endDate,
        notes: notes.trim() || undefined,
      });

      setStartDate('');
      setEndDate('');
      setNotes('');
      setSuccessMsg('Urlaubsantrag wurde erfolgreich eingereicht.');

      const [vacs, emp] = await Promise.all([
        api.vacations.list(currentEmp.id),
        api.employees.getMe(),
      ]);
      setMyVacations(vacs);
      setCurrentEmp(emp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Urlaub konnte nicht beantragt werden.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteVacation = async (employeeId: string, vacationId: string) => {
    if (!window.confirm('Diesen Urlaubsantrag wirklich stornieren / löschen?')) return;
    try {
      setError(null);
      setSuccessMsg(null);
      await api.vacations.delete(employeeId, vacationId);
      setSuccessMsg('Urlaubsantrag wurde storniert.');
      if (isEmployee && currentEmp) {
        const [vacs, emp] = await Promise.all([
          api.vacations.list(currentEmp.id),
          api.employees.getMe(),
        ]);
        setMyVacations(vacs);
        setCurrentEmp(emp);
      } else {
        const vacs = await api.vacations.listAll();
        setAllVacations(vacs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stornierung fehlgeschlagen.');
    }
  };

  const handleAddBlockedDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEmp || !blockedDate) return;
    try {
      setSubmitting(true);
      setError(null);
      setSuccessMsg(null);
      await api.blockedDays.create(currentEmp.id, {
        blocked_date: blockedDate,
        reason: blockedReason.trim() || undefined,
      });
      setBlockedDate('');
      setBlockedReason('');
      setSuccessMsg('Wunschfrei / Sperrtag wurde eingetragen.');
      const bds = await api.blockedDays.list(currentEmp.id);
      setMyBlockedDays(bds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sperrtag konnte nicht gespeichert werden.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteBlockedDay = async (id: string) => {
    if (!currentEmp) return;
    try {
      setError(null);
      setSuccessMsg(null);
      await api.blockedDays.delete(currentEmp.id, id);
      const bds = await api.blockedDays.list(currentEmp.id);
      setMyBlockedDays(bds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sperrtag konnte nicht gelöscht werden.');
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);
      setSuccessMsg(null);
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(prefs)) {
        if (v !== undefined && v !== null && !isNaN(v)) {
          cleaned[k] = v;
        }
      }
      const updated = await api.employees.updateMyPreferences(cleaned);
      setCurrentEmp(updated);
      setPrefs({ ...(updated.shift_preferences || {}) });
      setSuccessMsg('Deine Schicht-Präferenzen wurden erfolgreich gespeichert.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Präferenzen konnten nicht gespeichert werden.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReportSickRange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sickStart || !sickEnd) {
      setError('Bitte Start- und Enddatum der Krankmeldung angeben.');
      return;
    }
    if (!isEmployee && !sickEmpId) {
      setError('Bitte einen Mitarbeiter auswählen.');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      setSuccessMsg(null);
      const res = await api.assignments.markSickRange({
        employee_id: isEmployee ? currentEmp?.id : sickEmpId,
        start_date: sickStart,
        end_date: sickEnd,
        notes: sickNotes.trim() || undefined,
      });
      setSickStart('');
      setSickEnd('');
      setSickNotes('');
      setShowManagerSickModal(false);
      setSuccessMsg(
        `Krankmeldung gespeichert: ${res.marked_sick_count} geplante Schicht(en) als krank markiert (${res.swap_requests_created} Vertretungsgesuch(e) geöffnet).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Krankmeldung fehlgeschlagen.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (employeeId: string, vacationId: string) => {
    try {
      setError(null);
      await api.vacations.approve(employeeId, vacationId);
      const vacs = await api.vacations.listAll();
      setAllVacations(vacs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Genehmigung fehlgeschlagen.');
    }
  };

  const handleReject = async (employeeId: string, vacationId: string) => {
    try {
      setError(null);
      await api.vacations.reject(employeeId, vacationId);
      const vacs = await api.vacations.listAll();
      setAllVacations(vacs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ablehnung fehlgeschlagen.');
    }
  };

  const parseLocalDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };

  const closedDateSet = new Set(closedDays.map((c) => c.closed_date));

  const toISODateLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const calculateDays = (start: string, end: string) => {
    if (!start || !end) return 0;
    const s = parseLocalDate(start);
    const e = parseLocalDate(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
    let count = 0;
    const curr = new Date(s);
    while (curr <= e) {
      const day = curr.getDay();
      const iso = toISODateLocal(curr);
      if (day >= 1 && day <= 5 && !closedDateSet.has(iso)) {
        count += 1;
      }
      curr.setDate(curr.getDate() + 1);
    }
    return count;
  };

  const formatDate = (dateStr: string) => {
    const d = parseLocalDate(dateStr);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <span className="badge badge-success">{t('vacations.approved', 'Genehmigt')}</span>;
      case 'rejected':
        return <span className="badge badge-danger">{t('vacations.rejected', 'Abgelehnt')}</span>;
      default:
        return <span className="badge badge-warning">{t('vacations.pending', 'Ausstehend')}</span>;
    }
  };

  const getPrefLabel = (val: number) => {
    if (val === 5) return '🌟 Wunsch';
    if (val === 1) return '🚫 Sperrzeit';
    return '⚪ Neutral';
  };

  if (loading) {
    return (
      <div className="animate-fade-in" style={{ padding: 'var(--space-xl)' }}>
        <div className="skeleton" style={{ width: '280px', height: '32px', marginBottom: 'var(--space-md)' }} />
        <div className="skeleton-text" style={{ width: '400px', marginBottom: 'var(--space-xl)' }} />
        <div className="skeleton-card" style={{ height: '240px' }} />
      </div>
    );
  }

  const activeShiftTypes = shiftTypes.filter((st) => st.is_active);

  return (
    <div className="animate-fade-in" style={{ padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-xs)' }}>
            🌴 {isEmployee ? 'Urlaub, Wunschfrei & Verfügbarkeit' : t('vacations.title', 'Urlaubs- & Abwesenheitsverwaltung')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            {isEmployee
              ? 'Verwalte deine Urlaubsanträge, Wunschfrei-Tage, Schicht-Präferenzen und Krankmeldungen.'
              : 'Verwalte und genehmige Urlaubsanträge oder trage mehrtägige Krankmeldungen ein.'}
          </p>
        </div>
        {!isEmployee && (
          <button className="btn btn-secondary" onClick={() => setShowManagerSickModal(true)}>
            🤒 Krankmeldung (Zeitraum) eintragen
          </button>
        )}
      </div>

      {/* Feedback Alerts */}
      {error && (
        <div className="glass-card" style={{ padding: 'var(--space-md)', background: 'var(--danger-bg)', borderColor: 'var(--danger)' }}>
          <p style={{ color: 'var(--danger)', margin: 0, fontSize: '0.9rem' }}>⚠️ {error}</p>
        </div>
      )}
      {successMsg && (
        <div className="glass-card" style={{ padding: 'var(--space-md)', background: 'var(--success-bg)', borderColor: 'var(--success)' }}>
          <p style={{ color: 'var(--success)', margin: 0, fontSize: '0.9rem' }}>✓ {successMsg}</p>
        </div>
      )}

      {isEmployee ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          {/* Vacation Stats Row */}
          {currentEmp && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-md)' }}>
              <div className="glass-card" style={{ padding: 'var(--space-lg)', background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02))' }}>
                <h3 style={{ margin: '0 0 var(--space-xs) 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Jahresurlaub</h3>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--success)' }}>
                  {currentEmp.vacation_days_per_year} <span style={{ fontSize: '1rem', fontWeight: 500 }}>Tage</span>
                </div>
              </div>
              <div className="glass-card" style={{ padding: 'var(--space-lg)', background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(99,102,241,0.02))' }}>
                <h3 style={{ margin: '0 0 var(--space-xs) 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Verbleibender Resturlaub</h3>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary)' }}>
                  {currentEmp.vacation_days_remaining.toFixed(1)} <span style={{ fontSize: '1rem', fontWeight: 500 }}>Tage</span>
                </div>
              </div>
              <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
                <h3 style={{ margin: '0 0 var(--space-xs) 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Wunschfrei / Sperrtage</h3>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {myBlockedDays.length} <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Tage</span>
                </div>
              </div>
            </div>
          )}

          {/* Self-Service Navigation Tabs */}
          <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', borderBottom: '1px solid var(--border-primary)', paddingBottom: 'var(--space-xs)' }}>
            {[
              { key: 'vacation' as const, label: '🏖️ Urlaubsanträge' },
              { key: 'blocked' as const, label: '📅 Wunschfrei / Sperrtage' },
              { key: 'preferences' as const, label: '🌟 Schicht-Präferenzen' },
              { key: 'sick' as const, label: '🤒 Krankmeldung (AU)' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={activeTab === tab.key ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                onClick={() => {
                  setError(null);
                  setSuccessMsg(null);
                  setActiveTab(tab.key);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab 1: Vacation Requests */}
          {activeTab === 'vacation' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-lg)', alignItems: 'start' }}>
              <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 var(--space-md) 0', color: 'var(--text-primary)' }}>
                  Urlaub beantragen
                </h2>
                <form onSubmit={handleRequestVacation} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Startdatum</label>
                      <input className="input" type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Enddatum</label>
                      <input className="input" type="date" required value={endDate} onChange={e => setEndDate(e.target.value)} />
                    </div>
                  </div>

                  {startDate && endDate && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Anzurechnende Urlaubstage: <strong>{calculateDays(startDate, endDate)} Arbeitstage</strong> (ohne Wochenenden & Feiertage)
                    </div>
                  )}

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Notiz / Begründung</label>
                    <textarea className="input" style={{ minHeight: '80px', resize: 'vertical' }} placeholder="Optionale Notiz eingeben..." value={notes} onChange={e => setNotes(e.target.value)} />
                  </div>

                  <button className="btn btn-primary" type="submit" disabled={submitting}>
                    {submitting ? 'Sendet...' : 'Antrag einreichen'}
                  </button>
                </form>
              </div>

              <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 var(--space-md) 0', color: 'var(--text-primary)' }}>
                  Meine Urlaubsanträge
                </h2>

                {myVacations.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-tertiary)' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-sm)' }}>🏖️</div>
                    <p style={{ margin: 0 }}>Noch keine Anträge eingereicht.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    {myVacations.map(vac => (
                      <div key={vac.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-md)', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                            {formatDate(vac.start_date)} – {formatDate(vac.end_date)}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {calculateDays(vac.start_date, vac.end_date)} Tage {vac.notes && `• "${vac.notes}"`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                          {getStatusBadge(vac.status)}
                          {vac.status === 'requested' && currentEmp && (
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                              onClick={() => handleDeleteVacation(currentEmp.id, vac.id)}
                              title="Offenen Antrag stornieren"
                            >
                              Stornieren
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Blocked Days / Wunschfrei */}
          {activeTab === 'blocked' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-lg)', alignItems: 'start' }}>
              <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 var(--space-xs) 0', color: 'var(--text-primary)' }}>
                  Wunschfrei / Sperrtag eintragen
                </h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-md)' }}>
                  An gesperrten Tagen wirst du bei der automatischen Dienstplanung nicht eingeteilt (z. B. Arzttermin, Prüfung).
                </p>
                <form onSubmit={handleAddBlockedDay} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Datum</label>
                    <input className="input" type="date" required value={blockedDate} onChange={e => setBlockedDate(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Grund (optional)</label>
                    <input className="input" type="text" placeholder="z. B. Arzttermin, Vorlesung..." value={blockedReason} onChange={e => setBlockedReason(e.target.value)} />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={submitting}>
                    {submitting ? 'Speichert...' : '+ Sperrtag hinzufügen'}
                  </button>
                </form>
              </div>

              <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 var(--space-md) 0', color: 'var(--text-primary)' }}>
                  Meine eingetragenen Sperrtage
                </h2>
                {myBlockedDays.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-tertiary)' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-sm)' }}>📅</div>
                    <p style={{ margin: 0 }}>Keine Sperrtage eingetragen.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    {myBlockedDays.map((bd) => (
                      <div key={bd.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-md)', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                            {formatDate(bd.blocked_date)}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {bd.reason || 'Kein Grund angegeben'}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                          onClick={() => handleDeleteBlockedDay(bd.id)}
                        >
                          Löschen
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 3: Shift Preferences */}
          {activeTab === 'preferences' && (
            <div className="glass-card" style={{ padding: 'var(--space-lg)', overflowX: 'auto' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 var(--space-xs) 0', color: 'var(--text-primary)' }}>
                Wunsch- & Sperrzeiten nach Wochentag
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: 'var(--space-md)' }}>
                Der automatische Dienstplan bevorzugt deine Wunschzeiten (🌟) und teilt dich bei Sperrzeiten (🚫) nicht ein.
              </p>

              {activeShiftTypes.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Keine aktiven Schichttypen vorhanden.</p>
              ) : (
                <form onSubmit={handleSavePreferences}>
                  <div className="table-container" style={{ marginBottom: 'var(--space-md)', overflowX: 'auto' }}>
                    <table style={{ width: '100%', minWidth: '900px' }}>
                      <thead>
                        <tr>
                          <th>Schichttyp</th>
                          <th style={{ textAlign: 'center' }}>Standard</th>
                          {WEEKDAYS.map((d) => (
                            <th key={d.key} style={{ textAlign: 'center' }}>{d.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeShiftTypes.map((st) => {
                          const defaultVal = prefs[st.id] ?? 3;
                          return (
                            <tr key={st.id}>
                              <td>
                                <div style={{ fontWeight: 600 }}>{st.name}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {st.start_time.substring(0, 5)} – {st.end_time.substring(0, 5)}
                                </div>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <select
                                  className="input"
                                  value={defaultVal}
                                  onChange={(e) => setPrefs((p) => ({ ...p, [st.id]: parseInt(e.target.value) || 3 }))}
                                  style={{ padding: '4px 6px', fontSize: '0.8rem' }}
                                >
                                  <option value={5}>🌟 Wunsch</option>
                                  <option value={3}>⚪ Neutral</option>
                                  <option value={1}>🚫 Sperrzeit</option>
                                </select>
                              </td>
                              {WEEKDAYS.map((day) => {
                                const key = `${st.id}:${day.key}`;
                                const currentVal = prefs[key];
                                return (
                                  <td key={day.key} style={{ textAlign: 'center' }}>
                                    <select
                                      className="input"
                                      value={currentVal !== undefined ? currentVal : ''}
                                      onChange={(e) => {
                                        const valStr = e.target.value;
                                        setPrefs((p) => {
                                          const next = { ...p };
                                          if (valStr === '') delete next[key];
                                          else next[key] = parseInt(valStr) || 3;
                                          return next;
                                        });
                                      }}
                                      style={{ padding: '4px 6px', fontSize: '0.78rem' }}
                                    >
                                      <option value="">{`Std (${getPrefLabel(defaultVal)})`}</option>
                                      <option value={5}>🌟 Wunsch</option>
                                      <option value={3}>⚪ Neutral</option>
                                      <option value={1}>🚫 Sperrzeit</option>
                                    </select>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                      {submitting ? 'Speichert...' : 'Präferenzen speichern'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Tab 4: Multi-Day Sick Leave */}
          {activeTab === 'sick' && (
            <div className="glass-card" style={{ padding: 'var(--space-lg)', maxWidth: '580px' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 var(--space-xs) 0', color: 'var(--text-primary)' }}>
                🤒 Krankmeldung einreichen (Zeitraum von–bis)
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: 'var(--space-md)' }}>
                Alle bereits geplanten Schichten in diesem Zeitraum werden automatisch als <strong>Krank</strong> markiert und in die Vertretungsbörse gestellt.
              </p>
              <form onSubmit={handleReportSickRange} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Krank von</label>
                    <input className="input" type="date" required value={sickStart} onChange={e => setSickStart(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Voraussichtlich bis (inkl.)</label>
                    <input className="input" type="date" required value={sickEnd} onChange={e => setSickEnd(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Hinweis (optional)</label>
                  <input className="input" type="text" placeholder="z. B. AU liegt vor / Arztbesuch" value={sickNotes} onChange={e => setSickNotes(e.target.value)} />
                </div>
                <button type="submit" className="btn btn-danger" disabled={submitting}>
                  {submitting ? 'Wird gemeldet...' : '🤒 Jetzt krankmelden'}
                </button>
              </form>
            </div>
          )}
        </div>
      ) : (
        /* Manager View */
        <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 var(--space-md) 0', color: 'var(--text-primary)' }}>
            Eingegangene Urlaubsanträge
          </h2>

          {allVacations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
              <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>📂</div>
              <h3 style={{ margin: '0 0 var(--space-xs) 0', color: 'var(--text-secondary)' }}>Keine Urlaubsanträge</h3>
              <p style={{ margin: 0 }}>Es liegen aktuell keine Urlaubsanträge vor.</p>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Mitarbeiter</th>
                    <th>Zeitraum</th>
                    <th>Dauer</th>
                    <th>Notiz / Begründung</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {allVacations.map(vac => (
                    <tr key={vac.id}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {vac.employee_name || 'Mitarbeiter'}
                      </td>
                      <td>
                        {formatDate(vac.start_date)} – {formatDate(vac.end_date)}
                      </td>
                      <td>
                        {calculateDays(vac.start_date, vac.end_date)} Tag(e)
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontStyle: vac.notes ? 'normal' : 'italic' }}>
                        {vac.notes || 'keine Notiz'}
                      </td>
                      <td>{getStatusBadge(vac.status)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
                          {vac.status === 'requested' && (
                            <>
                              <button
                                className="btn btn-sm btn-success"
                                onClick={() => handleApprove(vac.employee_id, vac.id)}
                                style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                              >
                                ✓ Genehmigen
                              </button>
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={() => handleReject(vac.employee_id, vac.id)}
                                style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                              >
                                ✕ Ablehnen
                              </button>
                            </>
                          )}
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => handleDeleteVacation(vac.employee_id, vac.id)}
                            style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                            title="Urlaubsantrag löschen (bei genehmigtem Urlaub werden die Tage wieder gutgeschrieben)"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Manager Multi-Day Sick Leave Modal */}
      {showManagerSickModal && (
        <div className="modal-backdrop" onClick={() => setShowManagerSickModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <h3 style={{ margin: '0 0 var(--space-xs) 0', fontSize: '1.15rem', fontWeight: 700 }}>
              🤒 Mehrtagige Krankmeldung eintragen
            </h3>
            <p style={{ margin: '0 0 var(--space-md) 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Markiert alle geplanten Schichten des Mitarbeiters im gewählten Zeitraum als krank und stellt sie zur Vertretung in die Tauschbörse.
            </p>
            <form onSubmit={handleReportSickRange} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Mitarbeiter</label>
                <select className="input" required value={sickEmpId} onChange={(e) => setSickEmpId(e.target.value)}>
                  <option value="">-- Mitarbeiter wählen --</option>
                  {allEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Von</label>
                  <input className="input" type="date" required value={sickStart} onChange={(e) => setSickStart(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Bis (inkl.)</label>
                  <input className="input" type="date" required value={sickEnd} onChange={(e) => setSickEnd(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Notiz (optional)</label>
                <input className="input" type="text" placeholder="z. B. AU eingereicht" value={sickNotes} onChange={(e) => setSickNotes(e.target.value)} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowManagerSickModal(false)}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-danger" disabled={submitting}>
                  {submitting ? 'Speichert...' : '🤒 Krankmeldung speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
