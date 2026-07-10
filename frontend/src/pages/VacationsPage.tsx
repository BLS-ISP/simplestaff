import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import type { Employee, Vacation } from '../types';

interface VacationWithEmp extends Vacation {
  employee_name?: string;
}

export default function VacationsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userRole = user?.role || 'viewer';
  const isEmployee = userRole === 'viewer';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Employee-specific state
  const [currentEmp, setCurrentEmp] = useState<Employee | null>(null);
  const [myVacations, setMyVacations] = useState<Vacation[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');

  // Manager-specific state
  const [allVacations, setAllVacations] = useState<VacationWithEmp[]>([]);

  useEffect(() => {
    fetchData();
  }, [userRole]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      if (isEmployee) {
        // 1. Fetch employee profile linked to user email
        const emp = await api.employees.getMe();
        setCurrentEmp(emp);

        // 2. Fetch employee's own vacations
        const vacs = await api.vacations.list(emp.id);
        setMyVacations(vacs);
      } else {
        // Manager: Fetch all vacations across tenant
        const vacs = await api.vacations.listAll();
        setAllVacations(vacs);
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
      await api.vacations.create(currentEmp.id, {
        start_date: startDate,
        end_date: endDate,
        notes: notes.trim() || undefined,
      });

      // Reset form
      setStartDate('');
      setEndDate('');
      setNotes('');

      // Refresh list
      const vacs = await api.vacations.list(currentEmp.id);
      setMyVacations(vacs);

      // Re-fetch employee profile to update remaining vacation days
      const emp = await api.employees.getMe();
      setCurrentEmp(emp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Urlaub konnte nicht beantragt werden.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (employeeId: string, vacationId: string) => {
    try {
      setError(null);
      await api.vacations.approve(employeeId, vacationId);
      // Refresh list
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
      // Refresh list
      const vacs = await api.vacations.listAll();
      setAllVacations(vacs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ablehnung fehlgeschlagen.');
    }
  };

  const calculateDays = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const diffTime = Math.abs(e.getTime() - s.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return isNaN(diffDays) ? 0 : diffDays;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
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

  if (loading) {
    return (
      <div className="animate-fade-in" style={{ padding: 'var(--space-xl)' }}>
        <div className="skeleton" style={{ width: '280px', height: '32px', marginBottom: 'var(--space-md)' }} />
        <div className="skeleton-text" style={{ width: '400px', marginBottom: 'var(--space-xl)' }} />
        <div className="skeleton-card" style={{ height: '240px' }} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      {/* Title */}
      <div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-xs)' }}>
          🌴 {t('vacations.title', 'Urlaubsverwaltung')}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          {isEmployee
            ? 'Beantrage deinen Urlaub und behalte dein verbleibendes Urlaubssaldo im Blick.'
            : 'Verwalte, genehmige und bearbeite die Urlaubsanträge deiner Mitarbeiter.'}
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="glass-card" style={{ padding: 'var(--space-md)', background: 'var(--danger-bg)', borderColor: 'var(--danger)' }}>
          <p style={{ color: 'var(--danger)', margin: 0, fontSize: '0.9rem' }}>⚠️ {error}</p>
        </div>
      )}

      {/* Main Grid split depending on role */}
      {isEmployee ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-lg)' }}>
          {/* Vacation Stats Row */}
          {currentEmp && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-md)' }}>
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
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-lg)', alignItems: 'start' }}>
            {/* Vacation Request Form */}
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
                    Dauer: <strong>{calculateDays(startDate, endDate)} Kalendertage</strong>
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

            {/* My Vacation Requests */}
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
                    <div key={vac.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-md)', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)' }}>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                          {formatDate(vac.start_date)} - {formatDate(vac.end_date)}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {calculateDays(vac.start_date, vac.end_date)} Tage {vac.notes && `• "${vac.notes}"`}
                        </div>
                      </div>
                      <div>{getStatusBadge(vac.status)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
                        {formatDate(vac.start_date)} - {formatDate(vac.end_date)}
                      </td>
                      <td>
                        {calculateDays(vac.start_date, vac.end_date)} Tag(e)
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontStyle: vac.notes ? 'normal' : 'italic' }}>
                        {vac.notes || 'keine Notiz'}
                      </td>
                      <td>{getStatusBadge(vac.status)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {vac.status === 'requested' ? (
                          <div style={{ display: 'inline-flex', gap: 'var(--space-xs)' }}>
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
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
