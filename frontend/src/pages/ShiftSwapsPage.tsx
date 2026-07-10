import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import type { Employee, ShiftSwap, ShiftAssignment, ShiftType } from '../types';

export default function ShiftSwapsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userRole = user?.role || 'viewer';
  const isEmployee = userRole === 'viewer';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Core data
  const [swaps, setSwaps] = useState<ShiftSwap[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [myEmployee, setMyEmployee] = useState<Employee | null>(null);
  const [myUpcomingAssignments, setMyUpcomingAssignments] = useState<ShiftAssignment[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);

  // Form states for creating a swap
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [targetEmployeeId, setTargetEmployeeId] = useState('');
  const [notes, setNotes] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchData();
  }, [userRole]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      // Load all swaps and shift types
      const [swapList, allSts] = await Promise.all([
        api.shiftSwaps.list(),
        api.shiftTypes.list(),
      ]);
      setSwaps(swapList);
      setShiftTypes(allSts);

      // Load active employees list for targets selection
      const empRes = await api.employees.list({ is_active: true });
      setEmployees(empRes.data);

      if (isEmployee) {
        // Load logged-in employee profile
        const me = await api.employees.getMe();
        setMyEmployee(me);

        // Load upcoming assignments for this employee (next 30 days)
        const today = new Date().toISOString().split('T')[0];
        const nextMonth = new Date();
        nextMonth.setDate(nextMonth.getDate() + 30);
        const end = nextMonth.toISOString().split('T')[0];

        const assigns = await api.assignments.list({ start_date: today, end_date: end });
        setMyUpcomingAssignments(assigns.filter(a => a.employee_id === me.id));
      }
    } catch (err) {
      console.error('Error loading shift swaps data:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Tauschbörsen-Daten.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignmentId) return;

    try {
      setSubmitting(true);
      setError(null);
      setSuccess(null);

      await api.shiftSwaps.create({
        assignment_id: selectedAssignmentId,
        target_employee_id: targetEmployeeId || undefined,
        notes: notes.trim() || undefined,
      });

      setSuccess('Schicht wurde erfolgreich in die Tauschbörse eingestellt.');
      setSelectedAssignmentId('');
      setTargetEmployeeId('');
      setNotes('');
      setShowCreateModal(false);

      // Refresh data
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Einstellen der Schicht.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClaim = async (swapId: string) => {
    try {
      setError(null);
      setSuccess(null);
      await api.shiftSwaps.claim(swapId);
      setSuccess('Übernahme wurde vorgeschlagen. Bitte warte auf die Genehmigung des Planers.');
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Übernahme fehlgeschlagen.');
    }
  };

  const handleCancel = async (swapId: string) => {
    try {
      setError(null);
      setSuccess(null);
      await api.shiftSwaps.delete(swapId);
      setSuccess('Tauschantrag wurde storniert.');
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stornierung fehlgeschlagen.');
    }
  };

  const handleApprove = async (swapId: string) => {
    try {
      setError(null);
      setSuccess(null);
      await api.shiftSwaps.approve(swapId);
      setSuccess('Der Schichttausch wurde genehmigt und der Dienstplan aktualisiert.');
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Genehmigung fehlgeschlagen.');
    }
  };

  const handleReject = async (swapId: string) => {
    try {
      setError(null);
      setSuccess(null);
      await api.shiftSwaps.reject(swapId);
      setSuccess('Der Tauschantrag wurde abgelehnt (Schicht ist wieder offen).');
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ablehnung fehlgeschlagen.');
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <span className="badge badge-success">✓ Genehmigt</span>;
      case 'proposed':
        return <span className="badge badge-warning">⏳ Wartet auf Freigabe</span>;
      case 'rejected':
        return <span className="badge badge-danger">✕ Abgelehnt</span>;
      default:
        return <span className="badge badge-info">Offen</span>;
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-in" style={{ padding: 'var(--space-xl)' }}>
        <div className="skeleton" style={{ width: '280px', height: '32px', marginBottom: 'var(--space-md)' }} />
        <div className="skeleton-text" style={{ width: '400px', marginBottom: 'var(--space-xl)' }} />
        <div className="skeleton-card" style={{ height: '300px' }} />
      </div>
    );
  }

  // Filter lists in memory for employees
  const openMarketSwaps = swaps.filter(s =>
    s.status === 'open' &&
    myEmployee && s.requesting_employee_id !== myEmployee.id &&
    (s.target_employee_id === null || s.target_employee_id === myEmployee.id)
  );

  const mySwaps = swaps.filter(s => myEmployee && s.requesting_employee_id === myEmployee.id);
  const myApplications = swaps.filter(s => myEmployee && s.backup_employee_id === myEmployee.id);

  // Filter proposed swaps for planners
  const proposedSwaps = swaps.filter(s => s.status === 'proposed');
  const pastSwaps = swaps.filter(s => s.status !== 'proposed');

  const shiftTypeMap = new Map(shiftTypes.map(st => [st.id, st]));

  return (
    <div className="animate-fade-in" style={{ padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-xs)' }}>
            🔄 {t('nav.shiftSwaps', 'Schicht-Tauschbörse')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            {isEmployee
              ? 'Tausche deine Schichten mit Kollegen oder übernimm offene Dienste.'
              : 'Verwalte, überprüfe und genehmige die Schichttäusche deiner Mitarbeiter.'}
          </p>
        </div>
        {isEmployee && (
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            + Schicht abgeben
          </button>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="glass-card" style={{ padding: 'var(--space-md)', background: 'var(--danger-bg)', borderColor: 'var(--danger)' }}>
          <p style={{ color: 'var(--danger)', margin: 0, fontSize: '0.9rem' }}>⚠️ {error}</p>
        </div>
      )}
      {success && (
        <div className="glass-card" style={{ padding: 'var(--space-md)', background: 'var(--success-bg)', borderColor: 'var(--success)' }}>
          <p style={{ color: 'var(--success)', margin: 0, fontSize: '0.9rem' }}>✓ {success}</p>
        </div>
      )}

      {/* Main Grid */}
      {isEmployee ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
          {/* Marketplace */}
          <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 var(--space-md) 0', color: 'var(--text-primary)' }}>
              Offene Schichten (Marktplatz)
            </h2>
            {openMarketSwaps.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-tertiary)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-sm)' }}>🤝</div>
                <p style={{ margin: 0 }}>Aktuell keine Schichten zum Tauschen angeboten.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-md)' }}>
                {openMarketSwaps.map(swap => (
                  <div key={swap.id} style={{ border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 'var(--space-md)' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-xs)' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, padding: '3px 8px', borderRadius: 'var(--radius-sm)', background: `${swap.color}20`, color: swap.color }}>
                          {swap.shift_type_name}
                        </span>
                        {swap.target_employee_id && (
                          <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Direkt-Anfrage</span>
                        )}
                      </div>
                      <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 'var(--space-xs) 0', color: 'var(--text-primary)' }}>
                        {formatDate(swap.assignment_date)}
                      </h3>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 var(--space-xs) 0' }}>
                        Uhrzeit: {swap.start_time} - {swap.end_time}
                      </p>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                        Abgegeben von: <strong>{swap.requesting_employee_name}</strong>
                      </p>
                      {swap.notes && (
                        <p style={{ fontSize: '0.8rem', fontStyle: 'italic', background: 'var(--bg-primary)', padding: '6px var(--space-xs)', borderRadius: 'var(--radius-sm)', marginTop: 'var(--space-xs)', borderLeft: '3px solid var(--primary)', color: 'var(--text-secondary)' }}>
                          "{swap.notes}"
                        </p>
                      )}
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={() => handleClaim(swap.id)} style={{ alignSelf: 'stretch' }}>
                      Schicht übernehmen
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 'var(--space-lg)' }}>
            {/* My swap offers */}
            <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 var(--space-md) 0', color: 'var(--text-primary)' }}>
                Meine abgegebenen Schichten
              </h2>
              {mySwaps.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: 'var(--space-md)' }}>Du hast keine Schichten abgegeben.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                  {mySwaps.map(swap => (
                    <div key={swap.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-md)', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)' }}>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                          {formatDate(swap.assignment_date)} ({swap.shift_type_name})
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          Status: {getStatusBadge(swap.status)}
                          {swap.backup_employee_name && ` • Bewerber: ${swap.backup_employee_name}`}
                        </div>
                      </div>
                      {swap.status !== 'approved' && (
                        <button className="btn btn-sm btn-danger-outline" onClick={() => handleCancel(swap.id)} style={{ padding: '3px 8px', fontSize: '0.75rem' }}>
                          Stornieren
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* My claims on other shifts */}
            <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 var(--space-md) 0', color: 'var(--text-primary)' }}>
                Meine Übernahme-Bewerbungen
              </h2>
              {myApplications.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: 'var(--space-md)' }}>Du hast dich auf keine Schichten beworben.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                  {myApplications.map(swap => (
                    <div key={swap.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-md)', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)' }}>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                          {formatDate(swap.assignment_date)} ({swap.shift_type_name})
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          Abgabe von: {swap.requesting_employee_name} • {getStatusBadge(swap.status)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Planner Mode */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          {/* Awaiting Approvals */}
          <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 var(--space-md) 0', color: 'var(--text-primary)' }}>
              Ausstehende Freigaben (`proposed`)
            </h2>
            {proposedSwaps.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-tertiary)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-sm)' }}>📋</div>
                <p style={{ margin: 0 }}>Aktuell keine ausstehenden Tauschanträge zu prüfen.</p>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Schichttyp</th>
                      <th>Gegeben von</th>
                      <th>Übernommen von</th>
                      <th>Notizen</th>
                      <th style={{ textAlign: 'right' }}>Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposedSwaps.map(swap => (
                      <tr key={swap.id}>
                        <td style={{ fontWeight: 600 }}>{formatDate(swap.assignment_date)}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 'var(--radius-sm)', background: `${swap.color}20`, color: swap.color, fontSize: '0.8rem', fontWeight: 500 }}>
                            {swap.shift_type_name}
                          </span>
                        </td>
                        <td>{swap.requesting_employee_name}</td>
                        <td style={{ fontWeight: 600, color: 'var(--primary)' }}>{swap.backup_employee_name}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{swap.notes || '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 'var(--space-xs)' }}>
                            <button className="btn btn-sm btn-success" onClick={() => handleApprove(swap.id)} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                              ✓ Genehmigen
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => handleReject(swap.id)} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                              ✕ Ablehnen
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

          {/* Historical swapping lists */}
          <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 var(--space-md) 0', color: 'var(--text-primary)' }}>
              Verlauf / Alle Tauschanträge
            </h2>
            {pastSwaps.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-md)' }}>Kein Tausch-Verlauf vorhanden.</p>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Schichttyp</th>
                      <th>Gegeben von</th>
                      <th>Bewerber</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastSwaps.map(swap => (
                      <tr key={swap.id}>
                        <td>{formatDate(swap.assignment_date)}</td>
                        <td>{swap.shift_type_name}</td>
                        <td>{swap.requesting_employee_name}</td>
                        <td>{swap.backup_employee_name || (swap.target_employee_name ? `Direkt an: ${swap.target_employee_name}` : '—')}</td>
                        <td>{getStatusBadge(swap.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Swap Modal (Employee Only) */}
      {showCreateModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 'var(--space-md)' }}>
          <div className="glass-card animate-scale-up" style={{ width: '100%', maxWidth: '480px', padding: 'var(--space-lg)', background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0 }}>Schicht zur Tauschbörse freigeben</h2>
              <button onClick={() => setShowCreateModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            
            <form onSubmit={handleCreateSwap} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Schicht auswählen (Nächste 30 Tage)</label>
                <select className="input" required value={selectedAssignmentId} onChange={e => setSelectedAssignmentId(e.target.value)}>
                  <option value="">-- Schicht wählen --</option>
                  {myUpcomingAssignments.map(a => {
                    const st = shiftTypeMap.get(a.shift_type_id);
                    return (
                      <option key={a.id} value={a.id}>
                        {formatDate(a.assignment_date)} | {st ? `${st.name} (${st.start_time.substring(0, 5)}-${st.end_time.substring(0, 5)})` : 'Schicht'}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Direkt an einen Kollegen richten (Optional)</label>
                <select className="input" value={targetEmployeeId} onChange={e => setTargetEmployeeId(e.target.value)}>
                  <option value="">-- Öffentlich in der Tauschbörse --</option>
                  {employees.filter(emp => myEmployee && emp.id !== myEmployee.id).map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>Notiz / Begründung</label>
                <textarea className="input" style={{ minHeight: '80px', resize: 'vertical' }} placeholder="Z.B. 'Kann an diesem Tag leider nicht wegen Klausur...'" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', marginTop: 'var(--space-xs)' }}>
                <button className="btn btn-neutral" type="button" onClick={() => setShowCreateModal(false)}>Abbrechen</button>
                <button className="btn btn-primary" type="submit" disabled={submitting}>
                  {submitting ? 'Sendet...' : 'Freigeben'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
