// =============================================================================
// SimpleStaff – Employee Detail Page
// Tabbed view: Stammdaten | Gesperrte Tage | Urlaub | Präferenzen
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type {
  Employee,
  ShiftType,
  BlockedDay,
  Vacation,
  UpdateEmployeeRequest,
  CreateBlockedDayRequest,
  CreateVacationRequest,
} from '../types';
import { useAuth } from '../hooks/useAuth';

// ── Inline SVG Icons ──

const ArrowLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const PlusIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// ── Tab Types ──

type TabKey = 'stammdaten' | 'blocked' | 'vacation' | 'preferences';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'stammdaten', label: 'Stammdaten' },
  { key: 'blocked', label: 'Gesperrte Tage' },
  { key: 'vacation', label: 'Urlaub' },
  { key: 'preferences', label: 'Präferenzen' },
];

// ── Loading Skeleton ──

function DetailSkeleton() {
  return (
    <div className="animate-fade-in" style={{ padding: 'var(--space-xl)', maxWidth: '900px', margin: '0 auto' }}>
      <div className="skeleton-text" style={{ width: '120px', height: '1.5rem', marginBottom: 'var(--space-lg)' }} />
      <div className="skeleton-text" style={{ width: '50%', height: '2rem', marginBottom: 'var(--space-xl)' }} />
      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-xl)' }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton-text" style={{ width: '110px', height: '38px', borderRadius: 'var(--radius-md)' }} />
        ))}
      </div>
      <div className="skeleton-card" style={{ height: '400px', borderRadius: 'var(--radius-lg)' }} />
    </div>
  );
}

// ── Stammdaten Tab ──

interface StammdatenTabProps {
  employee: Employee;
  onSave: (data: UpdateEmployeeRequest) => Promise<void>;
  saving: boolean;
}

function StammdatenTab({ employee, onSave, saving }: StammdatenTabProps) {
  const [form, setForm] = useState({
    first_name: employee.first_name ?? '',
    last_name: employee.last_name ?? '',
    email: employee.email ?? '',
    phone: employee.phone ?? '',
    weekly_hours: employee.weekly_hours,
    vacation_days_per_year: employee.vacation_days_per_year,
    is_active: employee.is_active,
  });

  const [password, setPassword] = useState('start123');
  const [creatingUser, setCreatingUser] = useState(false);

  const handleCreateLogin = async () => {
    if (!password.trim() || password.length < 6) {
      alert('Das Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }
    try {
      setCreatingUser(true);
      await api.employees.createUser(employee.id, password.trim());
      alert(`Benutzerkonto für ${employee.first_name || 'den Mitarbeiter'} wurde erfolgreich erstellt!\nDer Mitarbeiter kann sich nun mit der E-Mail-Adresse "${employee.email}" und dem Passwort "${password}" anmelden.`);
      setPassword('start123');
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Fehler beim Erstellen des Logins.');
    } finally {
      setCreatingUser(false);
    }
  };

  // Sync form if employee prop changes
  useEffect(() => {
    setForm({
      first_name: employee.first_name ?? '',
      last_name: employee.last_name ?? '',
      email: employee.email ?? '',
      phone: employee.phone ?? '',
      weekly_hours: employee.weekly_hours,
      vacation_days_per_year: employee.vacation_days_per_year,
      is_active: employee.is_active,
    });
  }, [employee]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(form);
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.85rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: 'var(--space-xs)',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 'var(--space-lg)', alignItems: 'start' }}>
      {/* Left Column: Form Card */}
      <div className="glass-card animate-fade-in" style={{ padding: 'var(--space-xl)' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-lg)' }}>
          Persönliche Daten
        </h3>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
            <div className="form-group">
              <label style={labelStyle}>Vorname</label>
              <input
                className="input"
                type="text"
                value={form.first_name}
                onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label style={labelStyle}>Nachname</label>
              <input
                className="input"
                type="text"
                value={form.last_name}
                onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
            <label style={labelStyle}>E-Mail</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>

          <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
            <label style={labelStyle}>Telefon</label>
            <input
              className="input"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
            <div className="form-group">
              <label style={labelStyle}>Wochenstunden</label>
              <input
                className="input"
                type="number"
                min="0"
                max="60"
                step="0.5"
                value={form.weekly_hours}
                onChange={(e) => setForm((f) => ({ ...f, weekly_hours: parseFloat(e.target.value) || 0 }))}
              />
            </div>
            <div className="form-group">
              <label style={labelStyle}>Urlaubstage / Jahr</label>
              <input
                className="input"
                type="number"
                min="0"
                max="60"
                value={form.vacation_days_per_year}
                onChange={(e) => setForm((f) => ({ ...f, vacation_days_per_year: parseInt(e.target.value) || 0 }))}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-xl)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                style={{
                  width: 18,
                  height: 18,
                  cursor: 'pointer',
                  accentColor: 'var(--accent)',
                }}
              />
              <label
                htmlFor="is_active"
                style={{
                  fontSize: '0.9rem',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontWeight: 500,
                  userSelect: 'none',
                }}
              >
                Mitarbeiter ist aktiv
              </label>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Speichern…' : 'Änderungen speichern'}
            </button>
          </div>
        </form>
      </div>

      {/* Right Column: Status Summary & User Login Creation */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
        {/* Info card */}
        <div className="glass-card animate-fade-in" style={{ padding: 'var(--space-xl)' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-lg)' }}>
            Status & Übersicht
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-lg)',
            }}
          >
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Resturlaub</span>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                {employee.vacation_days_remaining} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Tage</span>
              </div>
            </div>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Aktivitätsstatus</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginTop: '8px' }}>
                <span className={`status-dot ${employee.is_active ? 'status-dot-active' : 'status-dot-inactive'}`} />
                <span style={{ fontWeight: 600, color: employee.is_active ? 'var(--success)' : 'var(--text-muted)' }}>
                  {employee.is_active ? 'Aktiv' : 'Inaktiv'}
                </span>
              </div>
            </div>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Wochenstunden (Soll)</span>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                {employee.weekly_hours} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Std.</span>
              </div>
            </div>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Urlaubstage / Jahr</span>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                {employee.vacation_days_per_year} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Tage</span>
              </div>
            </div>
          </div>
        </div>

        {/* Login Account card */}
        <div className="glass-card animate-fade-in" style={{ padding: 'var(--space-xl)' }}>
          <h4 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-xs)' }}>
            🔑 Benutzerkonto (Login)
          </h4>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 'var(--space-md)' }}>
            Schalte das Login für diesen Mitarbeiter frei. Er kann sich dann mit seiner E-Mail-Adresse und dem Passwort als Mitarbeiter (Viewer) anmelden.
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={labelStyle}>Passwort vergeben</label>
              <input
                className="input"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mind. 6 Zeichen, z.B. start123"
              />
            </div>
            <button
              type="button"
              className="btn btn-neutral"
              onClick={handleCreateLogin}
              disabled={creatingUser || !employee.email}
              style={{ width: '100%', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {creatingUser ? 'Schaltet frei...' : 'Login freischalten'}
            </button>
          </div>
          {!employee.email && (
            <p style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: 'var(--space-xs)', margin: 0 }}>
              * Um den Login freizuschalten, muss oben eine E-Mail-Adresse eingetragen und gespeichert sein.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Gesperrte Tage Tab ──

interface BlockedDaysTabProps {
  employeeId: string;
  blockedDays: BlockedDay[];
  onRefresh: () => void;
}

function BlockedDaysTab({ employeeId, blockedDays, onRefresh }: BlockedDaysTabProps) {
  const [form, setForm] = useState<CreateBlockedDayRequest>({ blocked_date: '', reason: '' });
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.blocked_date) return;
    try {
      setAdding(true);
      await api.blockedDays.create(employeeId, form);
      setForm({ blocked_date: '', reason: '' });
      onRefresh();
    } catch (err) {
      console.error('Add blocked day error:', err);
      alert(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Gesperrten Tag wirklich löschen?')) return;
    try {
      setDeleting(id);
      await api.blockedDays.delete(employeeId, id);
      onRefresh();
    } catch (err) {
      console.error('Delete blocked day error:', err);
      alert(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setDeleting(null);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.85rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: 'var(--space-xs)',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--space-lg)', alignItems: 'start' }}>
      {/* Left side: Add form */}
      <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-md)' }}>
          Neuen gesperrten Tag hinzufügen
        </h3>
        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div className="form-group">
            <label style={labelStyle}>Datum</label>
            <input
              className="input"
              type="date"
              value={form.blocked_date}
              onChange={(e) => setForm((f) => ({ ...f, blocked_date: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label style={labelStyle}>Grund (optional)</label>
            <input
              className="input"
              type="text"
              placeholder="z.B. Arzttermin"
              value={form.reason || ''}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={adding} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', height: '38px', marginTop: 'var(--space-sm)' }}>
            <PlusIcon />
            {adding ? 'Hinzufügen…' : 'Hinzufügen'}
          </button>
        </form>
      </div>

      {/* Right side: Table */}
      <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-md)' }}>
          Gesperrte Tage
        </h3>
        {blockedDays.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: 'var(--space-sm)', opacity: 0.5 }}>📅</div>
            <p style={{ fontWeight: 500, margin: 0 }}>Keine gesperrten Tage vorhanden</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Grund</th>
                  <th style={{ width: '80px', textAlign: 'center' }}>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {blockedDays
                  .sort((a, b) => a.blocked_date.localeCompare(b.blocked_date))
                  .map((bd) => (
                    <tr key={bd.id}>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(bd.blocked_date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </td>
                      <td style={{ color: bd.reason ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                        {bd.reason || '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="btn btn-danger btn-sm btn-icon"
                          onClick={() => handleDelete(bd.id)}
                          disabled={deleting === bd.id}
                          aria-label="Löschen"
                          style={{ padding: '4px 8px' }}
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Urlaub Tab ──

interface VacationTabProps {
  employeeId: string;
  vacations: Vacation[];
  isManager: boolean;
  onRefresh: () => void;
}

function VacationTab({ employeeId, vacations, isManager, onRefresh }: VacationTabProps) {
  const [form, setForm] = useState<CreateVacationRequest>({ start_date: '', end_date: '', notes: '' });
  const [adding, setAdding] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.start_date || !form.end_date) return;
    try {
      setAdding(true);
      await api.vacations.create(employeeId, form);
      setForm({ start_date: '', end_date: '', notes: '' });
      onRefresh();
    } catch (err) {
      console.error('Create vacation error:', err);
      alert(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setAdding(false);
    }
  };

  const handleApprove = async (vacId: string) => {
    try {
      setActionLoading(vacId);
      await api.vacations.approve(employeeId, vacId);
      onRefresh();
    } catch (err) {
      console.error('Approve vacation error:', err);
      alert(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (vacId: string) => {
    try {
      setActionLoading(vacId);
      await api.vacations.reject(employeeId, vacId);
      onRefresh();
    } catch (err) {
      console.error('Reject vacation error:', err);
      alert(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setActionLoading(null);
    }
  };

  function statusBadgeClass(status: string): string {
    switch (status) {
      case 'requested': return 'badge badge-warning';
      case 'approved': return 'badge badge-success';
      case 'rejected': return 'badge badge-danger';
      default: return 'badge badge-neutral';
    }
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'requested': return 'Beantragt';
      case 'approved': return 'Genehmigt';
      case 'rejected': return 'Abgelehnt';
      default: return status;
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.85rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: 'var(--space-xs)',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--space-lg)', alignItems: 'start' }}>
      {/* Left side: Add form */}
      <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-md)' }}>
          Neuen Urlaub beantragen
        </h3>
        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div className="form-group">
            <label style={labelStyle}>Von</label>
            <input
              className="input"
              type="date"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label style={labelStyle}>Bis</label>
            <input
              className="input"
              type="date"
              value={form.end_date}
              onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label style={labelStyle}>Notizen (optional)</label>
            <input
              className="input"
              type="text"
              placeholder="z.B. Familienurlaub"
              value={form.notes || ''}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={adding} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', height: '38px', marginTop: 'var(--space-sm)' }}>
            <PlusIcon />
            {adding ? 'Beantragen…' : 'Beantragen'}
          </button>
        </form>
      </div>

      {/* Right side: List */}
      <div className="glass-card" style={{ padding: 'var(--space-lg)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-md)' }}>
          Urlaubsliste
        </h3>
        {vacations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: 'var(--space-sm)', opacity: 0.5 }}>🏖️</div>
            <p style={{ fontWeight: 500, margin: 0 }}>Kein Urlaub eingetragen</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Zeitraum</th>
                  <th>Status</th>
                  <th>Notizen</th>
                  {isManager && <th style={{ width: '100px', textAlign: 'center' }}>Aktionen</th>}
                </tr>
              </thead>
              <tbody>
                {vacations
                  .sort((a, b) => b.start_date.localeCompare(a.start_date))
                  .map((v) => (
                    <tr key={v.id}>
                      <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {new Date(v.start_date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        {' – '}
                        {new Date(v.end_date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </td>
                      <td>
                        <span className={statusBadgeClass(v.status)}>{statusLabel(v.status)}</span>
                      </td>
                      <td style={{ color: v.notes ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                        {v.notes || '—'}
                      </td>
                      {isManager && (
                        <td style={{ textAlign: 'center' }}>
                          {v.status === 'requested' && (
                            <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'center' }}>
                              <button
                                className="btn btn-sm"
                                onClick={() => handleApprove(v.id)}
                                disabled={actionLoading === v.id}
                                style={{
                                  background: 'var(--success-bg)',
                                  color: 'var(--success)',
                                  border: '1px solid var(--success)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  padding: '3px 8px',
                                  fontSize: '0.75rem',
                                  borderRadius: 'var(--radius-sm)'
                                }}
                              >
                                {actionLoading === v.id ? '...' : '✓'}
                              </button>
                              <button
                                className="btn btn-sm"
                                onClick={() => handleReject(v.id)}
                                disabled={actionLoading === v.id}
                                style={{
                                  background: 'var(--danger-bg)',
                                  color: 'var(--danger)',
                                  border: '1px solid var(--danger)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  padding: '3px 8px',
                                  fontSize: '0.75rem',
                                  borderRadius: 'var(--radius-sm)'
                                }}
                              >
                                {actionLoading === v.id ? '...' : '✕'}
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Präferenzen Tab ──

interface PreferencesTabProps {
  employee: Employee;
  shiftTypes: ShiftType[];
  onSave: (prefs: Record<string, number>) => Promise<void>;
  saving: boolean;
}

const WEEKDAYS = [
  { key: 1, label: 'Montag' },
  { key: 2, label: 'Dienstag' },
  { key: 3, label: 'Mittwoch' },
  { key: 4, label: 'Donnerstag' },
  { key: 5, label: 'Freitag' },
  { key: 6, label: 'Samstag' },
  { key: 7, label: 'Sonntag' },
];

function PreferencesTab({ employee, shiftTypes, onSave, saving }: PreferencesTabProps) {
  const [prefs, setPrefs] = useState<Record<string, number>>(() => ({ ...employee.shift_preferences }));

  useEffect(() => {
    setPrefs({ ...employee.shift_preferences });
  }, [employee.shift_preferences]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedPrefs: Record<string, number> = {};
    for (const [k, v] of Object.entries(prefs)) {
      if (v !== undefined && v !== null && !isNaN(v)) {
        cleanedPrefs[k] = v;
      }
    }
    await onSave(cleanedPrefs);
  };

  const getPrefLabel = (val: number) => {
    if (val === 5) return '🌟 Wunsch';
    if (val === 1) return '🚫 Sperrzeit';
    return '⚪ Neutral';
  };

  const activeShiftTypes = shiftTypes.filter((st) => st.is_active);

  return (
    <div className="glass-card animate-fade-in" style={{ padding: 'var(--space-xl)', overflowX: 'auto' }}>
      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-xs)' }}>
        Wunsch- & Sperrzeiten (Verfügbarkeit)
      </h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 'var(--space-lg)' }}>
        Pflege hier deine wochentagsspezifischen Präferenzen. Der automatische Dienstplan bevorzugt Wunschzeiten (🌟) und schließt dich bei Sperrzeiten (🚫) aus.
      </p>

      {activeShiftTypes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>
          <p>Keine aktiven Schichttypen vorhanden</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="table-container" style={{ marginBottom: 'var(--space-lg)', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '950px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-primary)' }}>
                  <th style={{ textAlign: 'left', padding: 'var(--space-sm)' }}>Schichttyp</th>
                  <th style={{ textAlign: 'center', padding: 'var(--space-sm)', color: 'var(--primary)', fontWeight: 600, minWidth: '110px' }}>Standard</th>
                  {WEEKDAYS.map((day) => (
                    <th key={day.key} style={{ textAlign: 'center', padding: 'var(--space-sm)', minWidth: '110px' }}>
                      {day.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeShiftTypes.map((st) => {
                  const defaultVal = prefs[st.id] ?? 3;
                  return (
                    <tr key={st.id} style={{ borderBottom: '1px solid var(--border-secondary)' }}>
                      {/* Name & Time */}
                      <td style={{ padding: 'var(--space-md) var(--space-sm)', minWidth: '180px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: '10px',
                              height: '10px',
                              borderRadius: '50%',
                              backgroundColor: st.color,
                              boxShadow: `0 0 6px ${st.color}88`,
                            }}
                          />
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                            {st.name}
                          </span>
                        </div>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '14px', marginTop: '2px' }}>
                          {st.start_time.substring(0, 5)} – {st.end_time.substring(0, 5)}
                        </span>
                      </td>

                      {/* Default pref */}
                      <td style={{ padding: 'var(--space-sm)', textAlign: 'center' }}>
                        <select
                          className="input"
                          value={defaultVal}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 3;
                            setPrefs((p) => ({ ...p, [st.id]: val }));
                          }}
                          style={{
                            padding: '4px 8px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            borderRadius: 'var(--radius-sm)',
                            textAlign: 'center',
                            backgroundColor: defaultVal === 5 ? 'var(--success-bg)' : defaultVal === 1 ? 'var(--danger-bg)' : 'var(--bg-tertiary)',
                            color: defaultVal === 5 ? 'var(--success)' : defaultVal === 1 ? 'var(--danger)' : 'var(--text-primary)',
                            borderColor: defaultVal === 5 ? 'var(--success)' : defaultVal === 1 ? 'var(--danger)' : 'var(--border-primary)',
                          }}
                        >
                          <option value={5}>🌟 Wunsch</option>
                          <option value={3}>⚪ Neutral</option>
                          <option value={1}>🚫 Sperrzeit</option>
                        </select>
                      </td>

                      {/* Weekday specific select dropdowns */}
                      {WEEKDAYS.map((day) => {
                        const key = `${st.id}:${day.key}`;
                        const currentVal = prefs[key];
                        const displayVal = currentVal !== undefined ? currentVal : '';
                        const fallbackLabel = getPrefLabel(defaultVal);

                        return (
                          <td key={day.key} style={{ padding: 'var(--space-sm)', textAlign: 'center' }}>
                            <select
                              className="input"
                              value={displayVal}
                              onChange={(e) => {
                                const valStr = e.target.value;
                                setPrefs((p) => {
                                  const updated = { ...p };
                                  if (valStr === '') {
                                    delete updated[key];
                                  } else {
                                    updated[key] = parseInt(valStr) || 3;
                                  }
                                  return updated;
                                });
                              }}
                              style={{
                                padding: '4px 8px',
                                fontSize: '0.8rem',
                                borderRadius: 'var(--radius-sm)',
                                textAlign: 'center',
                                backgroundColor: currentVal === 5 ? 'var(--success-bg)' : currentVal === 1 ? 'var(--danger-bg)' : currentVal === 3 ? 'var(--bg-tertiary)' : 'transparent',
                                color: currentVal === 5 ? 'var(--success)' : currentVal === 1 ? 'var(--danger)' : currentVal === 3 ? 'var(--text-primary)' : 'var(--text-muted)',
                                borderColor: currentVal === 5 ? 'var(--success)' : currentVal === 1 ? 'var(--danger)' : currentVal === 3 ? 'var(--border-primary)' : 'var(--border-secondary)',
                                fontWeight: currentVal !== undefined ? 600 : 400,
                              }}
                            >
                              <option value="">{`Standard (${fallbackLabel})`}</option>
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-xl)' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Speichern…' : 'Verfügbarkeiten speichern'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Main Component ──

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t: _t } = useTranslation();
  const { user } = useAuth();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [blockedDays, setBlockedDays] = useState<BlockedDay[]>([]);
  const [vacations, setVacations] = useState<Vacation[]>([]);

  const [activeTab, setActiveTab] = useState<TabKey>('stammdaten');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isManager = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'planner';

  // Fetch employee data
  const fetchEmployee = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const [emp, sts] = await Promise.all([
        api.employees.get(id),
        api.shiftTypes.list(),
      ]);
      setEmployee(emp);
      setShiftTypes(sts);
    } catch (err) {
      console.error('Fetch employee error:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Fetch blocked days
  const fetchBlockedDays = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.blockedDays.list(id);
      setBlockedDays(res);
    } catch (err) {
      console.error('Fetch blocked days error:', err);
    }
  }, [id]);

  // Fetch vacations
  const fetchVacations = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.vacations.list(id);
      setVacations(res);
    } catch (err) {
      console.error('Fetch vacations error:', err);
    }
  }, [id]);

  useEffect(() => {
    fetchEmployee();
  }, [fetchEmployee]);

  // Load tab-specific data when switching tabs
  useEffect(() => {
    if (activeTab === 'blocked') fetchBlockedDays();
    if (activeTab === 'vacation') fetchVacations();
  }, [activeTab, fetchBlockedDays, fetchVacations]);

  // Update employee handler
  const handleUpdateEmployee = async (data: UpdateEmployeeRequest) => {
    if (!id) return;
    try {
      setSaving(true);
      const updated = await api.employees.update(id, data);
      setEmployee(updated);
    } catch (err) {
      console.error('Update employee error:', err);
      alert(err instanceof Error ? err.message : 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  // Delete employee handler
  const handleDeleteEmployee = async () => {
    if (!id) return;
    if (!confirm(`Mitarbeiter ${fullName} wirklich permanent löschen? Dies löscht auch alle zugeordneten Schichten und Urlaube.`)) return;
    try {
      setLoading(true);
      await api.employees.delete(id);
      navigate('/employees');
    } catch (err) {
      console.error('Delete employee error:', err);
      alert(err instanceof Error ? err.message : 'Fehler beim Löschen');
      setLoading(false);
    }
  };

  // Save preferences handler
  const handleSavePreferences = async (prefs: Record<string, number>) => {
    if (!id) return;
    try {
      setSaving(true);
      const updated = await api.employees.update(id, { shift_preferences: prefs });
      setEmployee(updated);
    } catch (err) {
      console.error('Update preferences error:', err);
      alert(err instanceof Error ? err.message : 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──

  if (loading) return <DetailSkeleton />;

  if (error || !employee) {
    return (
      <div
        className="animate-fade-in"
        style={{
          padding: 'var(--space-xl)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
        }}
      >
        <div className="glass-card" style={{ padding: 'var(--space-2xl)', textAlign: 'center', maxWidth: '480px' }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>⚠️</div>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space-sm)' }}>
            {error || 'Mitarbeiter nicht gefunden'}
          </h2>
          <button className="btn btn-primary" onClick={() => navigate('/employees')} style={{ marginTop: 'var(--space-md)' }}>
            Zurück zur Übersicht
          </button>
        </div>
      </div>
    );
  }

  const fullName = `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim() || 'Mitarbeiter';

  return (
    <div className="animate-fade-in" style={{ padding: 'var(--space-xl)', maxWidth: 'var(--content-max-width)', margin: '0 auto', width: '100%' }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => navigate('/employees')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-xs)',
            marginBottom: 'var(--space-md)',
            color: 'var(--text-secondary)',
          }}
        >
          <ArrowLeftIcon />
          Zurück
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
            <span className={`status-dot ${employee.is_active ? 'status-dot-active' : 'status-dot-inactive'}`} />
            <h1
              style={{
                fontSize: '1.85rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
                margin: 0,
              }}
            >
              {fullName}
            </h1>
          </div>
          <button
            className="btn btn-danger btn-sm"
            onClick={handleDeleteEmployee}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}
          >
            <TrashIcon />
            Löschen
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="tabs" style={{ marginBottom: 'var(--space-xl)' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      {activeTab === 'stammdaten' && (
        <StammdatenTab employee={employee} onSave={handleUpdateEmployee} saving={saving} />
      )}

      {activeTab === 'blocked' && (
        <BlockedDaysTab employeeId={id!} blockedDays={blockedDays} onRefresh={fetchBlockedDays} />
      )}

      {activeTab === 'vacation' && (
        <VacationTab
          employeeId={id!}
          vacations={vacations}
          isManager={isManager}
          onRefresh={fetchVacations}
        />
      )}

      {activeTab === 'preferences' && (
        <PreferencesTab
          employee={employee}
          shiftTypes={shiftTypes}
          onSave={handleSavePreferences}
          saving={saving}
        />
      )}
    </div>
  );
}
