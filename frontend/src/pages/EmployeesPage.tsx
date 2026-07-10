// =============================================================================
// SimpleStaff – Employees Page
// Employee management with search, grid cards, add modal, and pagination
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { Employee, PaginatedResponse, CreateEmployeeRequest } from '../types';

// ── Inline SVG Icons ──

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const MailIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const PhoneIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const PersonIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2 }}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// ── Loading Skeleton ──

function EmployeesSkeleton() {
  return (
    <div className="animate-fade-in" style={{ padding: 'var(--space-xl)' }}>
      {/* Header skeleton */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-lg)' }}>
        <div className="skeleton-text" style={{ width: '200px', height: '2rem' }} />
        <div className="skeleton-text" style={{ width: '180px', height: '40px', borderRadius: 'var(--radius-md)' }} />
      </div>
      {/* Search skeleton */}
      <div className="skeleton-text" style={{ width: '100%', maxWidth: '400px', height: '42px', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-xl)' }} />
      {/* Cards grid skeleton */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-lg)' }}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="skeleton-card" style={{ height: '200px', borderRadius: 'var(--radius-lg)' }} />
        ))}
      </div>
    </div>
  );
}

// ── Empty State ──

function EmptyState({ search }: { search: string }) {
  return (
    <div
      className="animate-fade-in"
      style={{
        textAlign: 'center',
        padding: 'var(--space-2xl)',
        color: 'var(--text-muted)',
        gridColumn: '1 / -1',
      }}
    >
      <PersonIcon />
      <p style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-secondary)', marginTop: 'var(--space-md)' }}>
        {search ? 'Keine Mitarbeiter gefunden' : 'Noch keine Mitarbeiter angelegt'}
      </p>
      <p style={{ fontSize: '0.9rem', marginTop: 'var(--space-xs)' }}>
        {search
          ? `Keine Ergebnisse für „${search}"`
          : 'Erstellen Sie Ihren ersten Mitarbeiter mit dem Button oben.'}
      </p>
    </div>
  );
}

// ── Add Employee Modal ──

interface AddModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: CreateEmployeeRequest) => Promise<void>;
  saving: boolean;
}

function AddEmployeeModal({ open, onClose, onSave, saving }: AddModalProps) {
  const [form, setForm] = useState<CreateEmployeeRequest>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    weekly_hours: 40,
    vacation_days_per_year: 30,
  });

  const handleChange = (field: keyof CreateEmployeeRequest, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(form);
    setForm({ first_name: '', last_name: '', email: '', phone: '', weekly_hours: 40, vacation_days_per_year: 30 });
  };

  if (!open) return null;

  return (
    <div
      className="modal-backdrop animate-fade-in"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
        padding: 'var(--space-lg)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="glass-card animate-slide-up"
        style={{
          width: '100%',
          maxWidth: '520px',
          padding: 'var(--space-xl)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--space-xl)',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Neuer Mitarbeiter
          </h2>
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            style={{ padding: '6px' }}
            aria-label="Schließen"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
            <div className="form-group">
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
                Vorname *
              </label>
              <input
                className="input"
                type="text"
                value={form.first_name || ''}
                onChange={(e) => handleChange('first_name', e.target.value)}
                required
                placeholder="Max"
              />
            </div>
            <div className="form-group">
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
                Nachname *
              </label>
              <input
                className="input"
                type="text"
                value={form.last_name || ''}
                onChange={(e) => handleChange('last_name', e.target.value)}
                required
                placeholder="Mustermann"
              />
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
              E-Mail
            </label>
            <input
              className="input"
              type="email"
              value={form.email || ''}
              onChange={(e) => handleChange('email', e.target.value)}
              placeholder="max@beispiel.de"
            />
          </div>

          <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
              Telefon
            </label>
            <input
              className="input"
              type="tel"
              value={form.phone || ''}
              onChange={(e) => handleChange('phone', e.target.value)}
              placeholder="+49 123 456789"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
            <div className="form-group">
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
                Wochenstunden
              </label>
              <input
                className="input"
                type="number"
                min="0"
                max="60"
                step="0.5"
                value={form.weekly_hours ?? 40}
                onChange={(e) => handleChange('weekly_hours', parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="form-group">
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
                Urlaubstage / Jahr
              </label>
              <input
                className="input"
                type="number"
                min="0"
                max="60"
                value={form.vacation_days_per_year ?? 30}
                onChange={(e) => handleChange('vacation_days_per_year', parseInt(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-sm)',
              marginTop: 'var(--space-xl)',
              paddingTop: 'var(--space-lg)',
              borderTop: '1px solid var(--border-primary)',
            }}
          >
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? (
                <>
                  <span className="skeleton" style={{ width: '14px', height: '14px', borderRadius: 'var(--radius-full)', display: 'inline-block' }} />
                  {' '}Speichern…
                </>
              ) : (
                'Speichern'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Component ──

export default function EmployeesPage() {
  const { t: _t } = useTranslation();
  const navigate = useNavigate();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const perPage = 50;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchEmployees = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res: PaginatedResponse<Employee> = await api.employees.list({ page, per_page: perPage });
      setEmployees(res.data);
      setTotal(res.total);
    } catch (err) {
      console.error('Employees fetch error:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Client-side search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter((e) => {
      const fullName = `${e.first_name ?? ''} ${e.last_name ?? ''}`.toLowerCase();
      const email = (e.email ?? '').toLowerCase();
      return fullName.includes(q) || email.includes(q);
    });
  }, [employees, search]);

  const totalPages = Math.ceil(total / perPage);

  // Add employee handler
  const handleAddEmployee = async (data: CreateEmployeeRequest) => {
    try {
      setSaving(true);
      await api.employees.create(data);
      setModalOpen(false);
      await fetchEmployees();
    } catch (err) {
      console.error('Create employee error:', err);
      alert(err instanceof Error ? err.message : 'Fehler beim Erstellen');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──

  if (loading && employees.length === 0) return <EmployeesSkeleton />;

  return (
    <div className="animate-fade-in" style={{ padding: 'var(--space-xl)', maxWidth: '1400px', margin: '0 auto' }}>
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--space-md)',
          marginBottom: 'var(--space-lg)',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.85rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            Mitarbeiter
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: 'var(--space-xs)' }}>
            {total} {total === 1 ? 'Mitarbeiter' : 'Mitarbeiter'} insgesamt
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setModalOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}
        >
          <PlusIcon />
          Neuer Mitarbeiter
        </button>
      </div>

      {/* ── Search Bar ── */}
      <div style={{ marginBottom: 'var(--space-xl)', position: 'relative', maxWidth: '420px' }}>
        <div
          style={{
            position: 'absolute',
            left: 'var(--space-sm)',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <SearchIcon />
        </div>
        <input
          className="input"
          type="text"
          placeholder="Mitarbeiter suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: '2.5rem', width: '100%' }}
        />
      </div>

      {/* ── Error ── */}
      {error && (
        <div
          className="animate-fade-in"
          style={{
            padding: 'var(--space-md) var(--space-lg)',
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--danger)',
            marginBottom: 'var(--space-lg)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" onClick={fetchEmployees}>
            Erneut laden
          </button>
        </div>
      )}

      {/* ── Employee Cards Grid ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 'var(--space-lg)',
        }}
      >
        {filtered.length === 0 ? (
          <EmptyState search={search} />
        ) : (
          filtered.map((emp, idx) => (
            <div
              key={emp.id}
              className="glass-card animate-slide-up"
              style={{
                padding: 'var(--space-lg)',
                cursor: 'pointer',
                transition: 'var(--transition-normal)',
                animationDelay: `${Math.min(idx * 40, 400)}ms`,
                animationFillMode: 'backwards',
              }}
              onClick={() => navigate(`/employees/${emp.id}`)}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = 'var(--shadow-glow-strong)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '';
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') navigate(`/employees/${emp.id}`);
              }}
            >
              {/* Name + Status */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-sm)',
                  marginBottom: 'var(--space-md)',
                }}
              >
                <span
                  className={`status-dot ${emp.is_active ? 'status-dot-active' : 'status-dot-inactive'}`}
                />
                <h3
                  style={{
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    margin: 0,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {`${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || '—'}
                </h3>
              </div>

              {/* Contact Details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', marginBottom: 'var(--space-md)' }}>
                {emp.email && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-xs)',
                      color: 'var(--text-secondary)',
                      fontSize: '0.85rem',
                    }}
                  >
                    <MailIcon />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {emp.email}
                    </span>
                  </div>
                )}
                {emp.phone && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-xs)',
                      color: 'var(--text-secondary)',
                      fontSize: '0.85rem',
                    }}
                  >
                    <PhoneIcon />
                    <span>{emp.phone}</span>
                  </div>
                )}
              </div>

              {/* Badges */}
              <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                <span className="badge badge-info">
                  Wochenstunden: {emp.weekly_hours} h
                </span>
                <span className="badge badge-success">
                  Resturlaub: {emp.vacation_days_remaining} Tage
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            marginTop: 'var(--space-2xl)',
          }}
        >
          <button
            className="btn btn-ghost btn-sm btn-icon"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="Vorherige Seite"
          >
            <ChevronLeftIcon />
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPage(p)}
              style={{ minWidth: '36px' }}
            >
              {p}
            </button>
          ))}

          <button
            className="btn btn-ghost btn-sm btn-icon"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            aria-label="Nächste Seite"
          >
            <ChevronRightIcon />
          </button>
        </div>
      )}

      {/* ── Add Employee Modal ── */}
      <AddEmployeeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleAddEmployee}
        saving={saving}
      />
    </div>
  );
}
