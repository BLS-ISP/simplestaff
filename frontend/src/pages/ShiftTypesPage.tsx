import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { ShiftType } from '../types';

interface ShiftTypeFormData {
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  color: string;
  valid_days: number[];
  min_staff: string;
  max_staff: string;
  holiday_mode: string;
}

const DEFAULT_FORM: ShiftTypeFormData = {
  name: '',
  start_time: '06:00',
  end_time: '14:00',
  break_minutes: 30,
  color: '#4F8EF7',
  valid_days: [1, 2, 3, 4, 5, 6, 7],
  min_staff: '',
  max_staff: '',
  holiday_mode: 'any_day',
};

function formatTime(hhmmss: string): string {
  return hhmmss.slice(0, 5);
}

function toHHMMSS(hhmm: string): string {
  return hhmm.length === 5 ? `${hhmm}:00` : hhmm;
}

function formatValidDays(days: number[]): string {
  if (!days || days.length === 0) return 'Keine Tage';
  if (days.length === 7) return 'Täglich';
  const sorted = [...days].sort((a, b) => a - b);
  const isMoFr = sorted.length === 5 && sorted.every((d, i) => d === i + 1);
  if (isMoFr) return 'Mo - Fr';
  const isWeekend = sorted.length === 2 && sorted[0] === 6 && sorted[1] === 7;
  if (isWeekend) return 'Sa, So';
  const labels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  return sorted.map((d) => labels[d - 1]).join(', ');
}

export default function ShiftTypesPage() {
  const { t } = useTranslation();

  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingType, setEditingType] = useState<ShiftType | null>(null);
  const [form, setForm] = useState<ShiftTypeFormData>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ShiftType | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchShiftTypes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.shiftTypes.list();
      setShiftTypes(data);
    } catch {
      setError(t('shiftTypes.loadError', 'Schichttypen konnten nicht geladen werden.'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchShiftTypes();
  }, [fetchShiftTypes]);

  const openAddModal = () => {
    setEditingType(null);
    setForm(DEFAULT_FORM);
    setShowModal(true);
  };

  const openEditModal = (st: ShiftType) => {
    setEditingType(st);
    setForm({
      name: st.name,
      start_time: formatTime(st.start_time),
      end_time: formatTime(st.end_time),
      break_minutes: st.break_minutes,
      color: st.color,
      valid_days: st.valid_days || [1, 2, 3, 4, 5, 6, 7],
      min_staff: st.min_staff !== null && st.min_staff !== undefined ? String(st.min_staff) : '',
      max_staff: st.max_staff !== null && st.max_staff !== undefined ? String(st.max_staff) : '',
      holiday_mode: st.holiday_mode || 'any_day',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingType(null);
    setForm(DEFAULT_FORM);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        start_time: toHHMMSS(form.start_time),
        end_time: toHHMMSS(form.end_time),
        break_minutes: form.break_minutes,
        color: form.color,
        valid_days: form.valid_days,
        min_staff: form.min_staff !== '' ? parseInt(form.min_staff) : null,
        max_staff: form.max_staff !== '' ? parseInt(form.max_staff) : null,
        holiday_mode: form.holiday_mode,
      };
      if (editingType) {
        await api.shiftTypes.update(editingType.id, payload);
      } else {
        await api.shiftTypes.create(payload);
      }
      closeModal();
      fetchShiftTypes();
    } catch {
      setError(t('shiftTypes.saveError', 'Schichttyp konnte nicht gespeichert werden.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.shiftTypes.delete(deleteTarget.id);
      setDeleteTarget(null);
      fetchShiftTypes();
    } catch {
      setError(t('shiftTypes.deleteError', 'Schichttyp konnte nicht gelöscht werden.'));
    } finally {
      setDeleting(false);
    }
  };

  const updateField = <K extends keyof ShiftTypeFormData>(key: K, value: ShiftTypeFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="animate-fade-in" style={{ padding: 'var(--space-lg)' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-xl)',
          flexWrap: 'wrap',
          gap: 'var(--space-md)',
        }}
      >
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.75rem', fontWeight: 700 }}>
          {t('shiftTypes.title', 'Schichttypen')}
        </h1>
        <button className="btn btn-primary" onClick={openAddModal}>
          + {t('shiftTypes.add', 'Neuer Schichttyp')}
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
            padding: 'var(--space-sm) var(--space-md)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-lg)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--space-lg)',
          }}
        >
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-card" style={{ height: 180, borderRadius: 'var(--radius-lg)' }} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && shiftTypes.length === 0 && !error && (
        <div
          className="glass-card"
          style={{
            textAlign: 'center',
            padding: 'var(--space-2xl)',
            color: 'var(--text-secondary)',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>🕐</div>
          <p style={{ fontSize: '1.1rem', marginBottom: 'var(--space-lg)' }}>
            {t('shiftTypes.empty', 'Noch keine Schichttypen vorhanden.')}
          </p>
          <button className="btn btn-primary" onClick={openAddModal}>
            + {t('shiftTypes.add', 'Neuer Schichttyp')}
          </button>
        </div>
      )}

      {/* Card Grid */}
      {!loading && shiftTypes.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--space-lg)',
          }}
        >
          {shiftTypes.map((st) => (
            <div
              key={st.id}
              className="glass-card animate-slide-up"
              style={{
                position: 'relative',
                borderLeft: `4px solid ${st.color}`,
                padding: 'var(--space-lg)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-sm)',
              }}
            >
              {/* Color indicator + Name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: st.color,
                    flexShrink: 0,
                    boxShadow: `0 0 8px ${st.color}66`,
                  }}
                />
                <span
                  style={{
                    fontSize: '1.2rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {st.name}
                </span>
                {!st.is_active && (
                  <span className="badge badge-neutral" style={{ marginLeft: 'auto' }}>
                    {t('common.inactive', 'Inaktiv')}
                  </span>
                )}
              </div>

              {/* Time */}
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                <span>🕐</span>
                <span>{formatTime(st.start_time)} – {formatTime(st.end_time)}</span>
              </div>

              {/* Break */}
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                <span>☕</span>
                <span>{st.break_minutes} Min. Pause</span>
              </div>

              {/* Day Validity */}
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                <span>📅</span>
                <span>Gültig: {formatValidDays(st.valid_days)}</span>
              </div>

              {/* Staffing Limits */}
              {(st.min_staff !== null || st.max_staff !== null) && (
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                  <span>👥</span>
                  <span>
                    Besetzung: {st.min_staff !== null && st.min_staff !== undefined ? `Min. ${st.min_staff}` : 'Kein Min.'}
                    {st.max_staff !== null && st.max_staff !== undefined ? ` / Max. ${st.max_staff}` : ''}
                  </span>
                </div>
              )}

              {/* Holiday Validity */}
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                <span>🏖️</span>
                <span>
                  Feiertage: {st.holiday_mode === 'no_holidays' ? 'Nicht an Feiertagen' : st.holiday_mode === 'only_holidays' ? 'Nur an Feiertagen' : 'An allen Tagen'}
                </span>
              </div>

              {/* Actions */}
              <div style={{ marginTop: 'auto', paddingTop: 'var(--space-md)', display: 'flex', gap: 'var(--space-sm)' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => openEditModal(st)}>
                  ✏️ {t('common.edit', 'Bearbeiten')}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(st)}>
                  🗑️ {t('common.delete', 'Löschen')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add / Edit Modal ── */}
      {showModal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div
            className="modal animate-slide-up"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480, width: '100%' }}
          >
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>
                {editingType
                  ? t('shiftTypes.edit', 'Schichttyp bearbeiten')
                  : t('shiftTypes.add', 'Neuer Schichttyp')}
              </h2>
              <button className="btn btn-ghost btn-icon" onClick={closeModal}>✕</button>
            </div>

            <div style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {/* Name */}
              <div className="form-group">
                <label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)', display: 'block' }}>
                  {t('shiftTypes.name', 'Name')}
                </label>
                <input
                  className="input"
                  type="text"
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder={t('shiftTypes.namePlaceholder', 'z.B. Frühschicht')}
                  autoFocus
                />
              </div>

              {/* Times */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)', display: 'block' }}>
                    {t('shiftTypes.startTime', 'Beginn')}
                  </label>
                  <input
                    className="input"
                    type="time"
                    value={form.start_time}
                    onChange={(e) => updateField('start_time', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)', display: 'block' }}>
                    {t('shiftTypes.endTime', 'Ende')}
                  </label>
                  <input
                    className="input"
                    type="time"
                    value={form.end_time}
                    onChange={(e) => updateField('end_time', e.target.value)}
                  />
                </div>
              </div>

              {/* Break + Color */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)', display: 'block' }}>
                    {t('shiftTypes.break', 'Pause (Min.)')}
                  </label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={480}
                    value={form.break_minutes}
                    onChange={(e) => updateField('break_minutes', Math.max(0, parseInt(e.target.value) || 0))}
                  />
                </div>
                <div className="form-group">
                  <label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)', display: 'block' }}>
                    {t('shiftTypes.color', 'Farbe')}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) => updateField('color', e.target.value)}
                      style={{
                        width: 44,
                        height: 44,
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        background: 'transparent',
                      }}
                    />
                    <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                      {form.color}
                    </span>
                  </div>
                </div>
              </div>

              {/* Staffing Limits (Min/Max) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)', display: 'block' }}>
                    {t('shiftTypes.minStaff', 'Mindestbesetzung')}
                  </label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    placeholder="Keine"
                    value={form.min_staff}
                    onChange={(e) => updateField('min_staff', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)', display: 'block' }}>
                    {t('shiftTypes.maxStaff', 'Maximalbesetzung')}
                  </label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    placeholder="Keine"
                    value={form.max_staff}
                    onChange={(e) => updateField('max_staff', e.target.value)}
                  />
                </div>
              </div>

              {/* Day validity selector */}
              <div className="form-group" style={{ marginTop: 'var(--space-xs)' }}>
                <label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)', display: 'block' }}>
                  {t('shiftTypes.validDays', 'Tagesgültigkeit')}
                </label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[
                    { value: 1, label: 'Mo' },
                    { value: 2, label: 'Di' },
                    { value: 3, label: 'Mi' },
                    { value: 4, label: 'Do' },
                    { value: 5, label: 'Fr' },
                    { value: 6, label: 'Sa' },
                    { value: 7, label: 'So' },
                  ].map((day) => {
                    const isSelected = form.valid_days.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => {
                          const nextDays = isSelected
                            ? form.valid_days.filter((d) => d !== day.value)
                            : [...form.valid_days, day.value].sort();
                          updateField('valid_days', nextDays);
                        }}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 'var(--radius-md)',
                          fontSize: '0.8rem',
                          fontWeight: 500,
                          cursor: 'pointer',
                          border: '1px solid var(--border-primary)',
                          background: isSelected ? 'var(--accent)' : 'var(--bg-tertiary)',
                          color: isSelected ? '#fff' : 'var(--text-secondary)',
                          transition: 'all var(--transition-fast)',
                        }}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Holiday Mode */}
              <div className="form-group" style={{ marginTop: 'var(--space-xs)' }}>
                <label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)', display: 'block' }}>
                  Gültigkeit an Feiertagen
                </label>
                <select
                  className="input"
                  value={form.holiday_mode}
                  onChange={(e) => updateField('holiday_mode', e.target.value)}
                  style={{ width: '100%', cursor: 'pointer' }}
                >
                  <option value="any_day">An allen Tagen gültig (inkl. Feiertage)</option>
                  <option value="no_holidays">Nicht an Feiertagen gültig</option>
                  <option value="only_holidays">Nur an Feiertagen gültig</option>
                </select>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={closeModal} disabled={saving}>
                {t('common.cancel', 'Abbrechen')}
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? '...' : t('common.save', 'Speichern')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => !deleting && setDeleteTarget(null)}>
          <div
            className="modal animate-slide-up"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 420, width: '100%' }}
          >
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>
                {t('shiftTypes.deleteTitle', 'Schichttyp löschen')}
              </h2>
            </div>
            <div style={{ padding: 'var(--space-lg)', color: 'var(--text-secondary)' }}>
              <p style={{ margin: 0 }}>
                {t('shiftTypes.deleteConfirm', 'Möchten Sie den Schichttyp')}
                {' '}<strong style={{ color: 'var(--text-primary)' }}>{deleteTarget.name}</strong>{' '}
                {t('shiftTypes.deleteConfirm2', 'wirklich löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.')}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                {t('common.cancel', 'Abbrechen')}
              </button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? '...' : t('common.delete', 'Löschen')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
