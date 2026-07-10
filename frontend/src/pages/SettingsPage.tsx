import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { Tenant, TenantSettings, BreakRule, ClosedDay } from '../types';
import { useAuth } from '../hooks/useAuth';

const DEFAULT_BREAK_RULES: BreakRule[] = [
  { from_hours: 6, break_minutes: 30 },
  { from_hours: 9, break_minutes: 45 },
];

export default function SettingsPage() {
  const { t: _t } = useTranslation();
  const { isAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  // Business info
  const [name, setName] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);

  // Work time settings
  const [maxDailyHours, setMaxDailyHours] = useState(10);
  const [minRestHours, setMinRestHours] = useState(11);
  const [maxWeeklyHours, setMaxWeeklyHours] = useState(48);

  // Break rules
  const [breakRules, setBreakRules] = useState<BreakRule[]>(DEFAULT_BREAK_RULES);

  // Settings save state
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Closed days
  const [closedDays, setClosedDays] = useState<ClosedDay[]>([]);
  const [newClosedDate, setNewClosedDate] = useState('');
  const [newClosedDesc, setNewClosedDesc] = useState('');
  const [newClosedIsHoliday, setNewClosedIsHoliday] = useState(true);
  const [closedDaysLoading, setClosedDaysLoading] = useState(false);
  const [closedDaysError, setClosedDaysError] = useState<string | null>(null);

  const fetchClosedDays = async () => {
    try {
      const data = await api.closedDays.list();
      setClosedDays(data);
    } catch (err) {
      console.error('Failed to load closed days:', err);
    }
  };

  const handleAddClosedDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClosedDate || !newClosedDesc.trim()) return;
    try {
      setClosedDaysLoading(true);
      setClosedDaysError(null);
      await api.closedDays.create({
        closed_date: newClosedDate,
        description: newClosedDesc.trim(),
        is_holiday: newClosedIsHoliday,
      });
      setNewClosedDate('');
      setNewClosedDesc('');
      setNewClosedIsHoliday(true);
      await fetchClosedDays();
    } catch (err) {
      console.error(err);
      setClosedDaysError(err instanceof Error ? err.message : 'Fehler beim Hinzufügen.');
    } finally {
      setClosedDaysLoading(false);
    }
  };

  const handleDeleteClosedDay = async (id: string) => {
    if (!confirm('Eintrag wirklich löschen?')) return;
    try {
      await api.closedDays.delete(id);
      await fetchClosedDays();
    } catch (err) {
      console.error(err);
      alert('Fehler beim Löschen des Eintrags.');
    }
  };

  useEffect(() => {
    if (isAdmin()) {
      fetchTenant();
      fetchClosedDays();
    }
  }, []);

  const fetchTenant = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.tenants.get();
      setTenant(data);
      setName(data.name);

      const s = data.settings || {};
      setMaxDailyHours(s.max_daily_hours ?? 10);
      setMinRestHours(s.min_rest_hours ?? 11);
      setMaxWeeklyHours(s.max_weekly_hours ?? 48);
      setBreakRules(s.break_rules && s.break_rules.length > 0 ? s.break_rules : DEFAULT_BREAK_RULES);
    } catch (err) {
      setError('Fehler beim Laden der Einstellungen.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveName = async () => {
    if (!name.trim()) return;
    try {
      setNameSaving(true);
      setNameSuccess(false);
      const updated = await api.tenants.update({ name });
      setTenant(updated);
      setNameSuccess(true);
      setTimeout(() => setNameSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      setSettingsError('Fehler beim Speichern des Betriebsnamens.');
      setTimeout(() => setSettingsError(null), 4000);
    } finally {
      setNameSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      setSettingsSaving(true);
      setSettingsSuccess(false);
      setSettingsError(null);

      const settings: TenantSettings = {
        max_daily_hours: maxDailyHours,
        min_rest_hours: minRestHours,
        max_weekly_hours: maxWeeklyHours,
        break_rules: breakRules.filter((r) => r.from_hours > 0 && r.break_minutes > 0),
      };

      const updated = await api.tenants.updateSettings({ settings });
      setTenant(updated);
      setSettingsSuccess(true);
      setTimeout(() => setSettingsSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      setSettingsError('Fehler beim Speichern der Einstellungen.');
      setTimeout(() => setSettingsError(null), 4000);
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleAddBreakRule = () => {
    setBreakRules((prev) => [...prev, { from_hours: 0, break_minutes: 0 }]);
  };

  const handleRemoveBreakRule = (index: number) => {
    setBreakRules((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateBreakRule = (index: number, field: keyof BreakRule, value: number) => {
    setBreakRules((prev) =>
      prev.map((rule, i) => (i === index ? { ...rule, [field]: value } : rule))
    );
  };

  // Access denied
  if (!isAdmin()) {
    return (
      <div className="animate-fade-in" style={{
        padding: 'var(--space-xl)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '60vh',
      }}>
        <div className="glass-card" style={{
          padding: 'var(--space-2xl)',
          textAlign: 'center',
          maxWidth: '480px',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>🔒</div>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space-sm)' }}>
            Zugriff verweigert
          </h2>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
            Du benötigst Administratorrechte, um auf die Einstellungen zugreifen zu können.
          </p>
        </div>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="animate-fade-in" style={{ padding: 'var(--space-xl)', maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="skeleton" style={{ width: '280px', height: '32px', marginBottom: 'var(--space-sm)' }} />
          <div className="skeleton-text" style={{ width: '200px' }} />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton-card" style={{ height: '200px', marginBottom: 'var(--space-lg)' }} />
        ))}
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="animate-fade-in" style={{ padding: 'var(--space-xl)', maxWidth: '900px', margin: '0 auto' }}>
        <div className="glass-card" style={{
          padding: 'var(--space-xl)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>⚠️</div>
          <h2 style={{ color: 'var(--danger)', marginBottom: 'var(--space-sm)' }}>Fehler</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-md)' }}>{error}</p>
          <button className="btn btn-primary" onClick={fetchTenant}>
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ padding: 'var(--space-xl)', maxWidth: '900px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <h1 style={{
          fontSize: '1.75rem',
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 'var(--space-xs)',
        }}>
          ⚙️ Einstellungen
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          Verwalte deinen Betrieb und die Arbeitszeitregelungen.
        </p>
      </div>

      {/* Global feedback */}
      {settingsError && (
        <div className="glass-card animate-fade-in" style={{
          padding: 'var(--space-md)',
          marginBottom: 'var(--space-lg)',
          background: 'var(--danger-bg)',
          borderColor: 'var(--danger)',
        }}>
          <p style={{ color: 'var(--danger)', margin: 0 }}>❌ {settingsError}</p>
        </div>
      )}

      {/* Section 1: Betriebsinformationen */}
      <div className="glass-card animate-slide-up" style={{
        padding: 'var(--space-lg)',
        marginBottom: 'var(--space-lg)',
      }}>
        <h2 style={{
          fontSize: '1.2rem',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 'var(--space-lg)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
        }}>
          🏢 Betriebsinformationen
        </h2>

        <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
          <label style={{
            display: 'block',
            fontSize: '0.85rem',
            fontWeight: 500,
            color: 'var(--text-secondary)',
            marginBottom: 'var(--space-xs)',
          }}>
            Betriebsname
          </label>
          <input
            className="input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name des Betriebs"
          />
        </div>

        <div className="form-group" style={{ marginBottom: 'var(--space-lg)' }}>
          <label style={{
            display: 'block',
            fontSize: '0.85rem',
            fontWeight: 500,
            color: 'var(--text-secondary)',
            marginBottom: 'var(--space-xs)',
          }}>
            Slug
          </label>
          <div style={{
            padding: 'var(--space-sm) var(--space-md)',
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-secondary)',
            color: 'var(--text-muted)',
            fontSize: '0.9rem',
            fontFamily: 'monospace',
          }}>
            {tenant?.slug || '—'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <button
            className="btn btn-primary"
            onClick={handleSaveName}
            disabled={nameSaving || !name.trim()}
          >
            {nameSaving ? '⌛ Speichere…' : '💾 Betriebsname speichern'}
          </button>
          {nameSuccess && (
            <span className="badge badge-success animate-fade-in">✅ Gespeichert</span>
          )}
        </div>
      </div>

      {/* Section 2: Arbeitszeitregelungen */}
      <div className="glass-card animate-slide-up" style={{
        padding: 'var(--space-lg)',
        marginBottom: 'var(--space-lg)',
      }}>
        <h2 style={{
          fontSize: '1.2rem',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 'var(--space-lg)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
        }}>
          ⚖️ Arbeitszeitregelungen
        </h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--space-lg)',
        }}>
          <div className="form-group">
            <label style={{
              display: 'block',
              fontSize: '0.85rem',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-xs)',
            }}>
              Max. Tagesarbeitszeit (Std.)
            </label>
            <input
              className="input"
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={maxDailyHours}
              onChange={(e) => setMaxDailyHours(parseFloat(e.target.value) || 0)}
            />
          </div>

          <div className="form-group">
            <label style={{
              display: 'block',
              fontSize: '0.85rem',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-xs)',
            }}>
              Min. Ruhezeit (Std.)
            </label>
            <input
              className="input"
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={minRestHours}
              onChange={(e) => setMinRestHours(parseFloat(e.target.value) || 0)}
            />
          </div>

          <div className="form-group">
            <label style={{
              display: 'block',
              fontSize: '0.85rem',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-xs)',
            }}>
              Max. Wochenarbeitszeit (Std.)
            </label>
            <input
              className="input"
              type="number"
              min={1}
              max={168}
              step={1}
              value={maxWeeklyHours}
              onChange={(e) => setMaxWeeklyHours(parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
      </div>

      {/* Section 3: Pausenregelungen */}
      <div className="glass-card animate-slide-up" style={{
        padding: 'var(--space-lg)',
        marginBottom: 'var(--space-lg)',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-lg)',
        }}>
          <h2 style={{
            fontSize: '1.2rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
          }}>
            ☕ Pausenregelungen
          </h2>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleAddBreakRule}
          >
            ➕ Regel hinzufügen
          </button>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Ab (Stunden)</th>
                <th>Pause (Minuten)</th>
                <th style={{ width: '80px', textAlign: 'center' }}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {breakRules.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-lg)' }}>
                    Keine Pausenregelungen definiert.
                  </td>
                </tr>
              ) : (
                breakRules.map((rule, index) => (
                  <tr key={index}>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={24}
                        step={0.5}
                        value={rule.from_hours}
                        onChange={(e) =>
                          handleUpdateBreakRule(index, 'from_hours', parseFloat(e.target.value) || 0)
                        }
                        style={{ width: '100%', maxWidth: '160px' }}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={120}
                        step={5}
                        value={rule.break_minutes}
                        onChange={(e) =>
                          handleUpdateBreakRule(index, 'break_minutes', parseFloat(e.target.value) || 0)
                        }
                        style={{ width: '100%', maxWidth: '160px' }}
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="btn btn-danger btn-sm btn-icon"
                        onClick={() => handleRemoveBreakRule(index)}
                        title="Regel entfernen"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p style={{
          marginTop: 'var(--space-md)',
          marginBottom: 0,
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
          fontStyle: 'italic',
        }}>
          💡 Gemäß ArbZG: Bei einer Arbeitszeit von mehr als 6 Stunden sind mindestens 30 Minuten Pause vorgeschrieben,
          bei mehr als 9 Stunden mindestens 45 Minuten.
        </p>
      </div>

      {/* Save All Settings Button */}
      <div className="glass-card animate-slide-up" style={{
        padding: 'var(--space-lg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 'var(--space-md)',
      }}>
        <div>
          <h3 style={{
            margin: 0,
            fontSize: '1rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            Arbeitszeiteinstellungen speichern
          </h3>
          <p style={{
            margin: 0,
            marginTop: 'var(--space-xs)',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
          }}>
            Speichert Arbeitszeitregelungen und Pausenregelungen.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          {settingsSuccess && (
            <span className="badge badge-success animate-fade-in">✅ Einstellungen gespeichert</span>
          )}
          <button
            className="btn btn-primary btn-lg"
            onClick={handleSaveSettings}
            disabled={settingsSaving}
          >
            {settingsSaving ? '⏳ Speichere…' : '💾 Einstellungen speichern'}
          </button>
        </div>
      </div>

      {/* Section 4: Feiertage & Schließtage */}
      <div className="glass-card animate-slide-up" style={{
        padding: 'var(--space-lg)',
        marginTop: 'var(--space-lg)',
        marginBottom: 'var(--space-lg)',
      }}>
        <h2 style={{
          fontSize: '1.2rem',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 'var(--space-lg)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
        }}>
          📅 Feiertage & Betriebsschließungen
        </h2>

        {closedDaysError && (
          <div style={{ color: 'var(--danger)', fontSize: '0.9rem', marginBottom: 'var(--space-md)' }}>
            ⚠️ {closedDaysError}
          </div>
        )}

        {/* Add Closed Day Form */}
        <form onSubmit={handleAddClosedDay} style={{
          display: 'flex',
          gap: 'var(--space-md)',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          marginBottom: 'var(--space-xl)',
          background: 'rgba(255, 255, 255, 0.02)',
          padding: 'var(--space-md)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-primary)',
        }}>
          <div className="form-group" style={{ flex: '1 1 150px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
              Datum *
            </label>
            <input
              type="date"
              className="input"
              required
              value={newClosedDate}
              onChange={(e) => setNewClosedDate(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ flex: '2 1 250px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
              Bezeichnung *
            </label>
            <input
              type="text"
              className="input"
              required
              placeholder="z.B. Sommerpause, Karfreitag"
              value={newClosedDesc}
              onChange={(e) => setNewClosedDesc(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', paddingBottom: '12px' }}>
            <input
              type="checkbox"
              id="is_holiday"
              checked={newClosedIsHoliday}
              onChange={(e) => setNewClosedIsHoliday(e.target.checked)}
              style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--accent)' }}
            />
            <label htmlFor="is_holiday" style={{ fontSize: '0.9rem', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 500, userSelect: 'none' }}>
              Gesetzlicher Feiertag
            </label>
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: '42px', minWidth: '120px' }} disabled={closedDaysLoading}>
            {closedDaysLoading ? '...' : 'Hinzufügen'}
          </button>
        </form>

        {/* Closed Days List Table */}
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Bezeichnung</th>
                <th>Typ</th>
                <th style={{ width: '80px', textAlign: 'center' }}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {closedDays.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-lg)' }}>
                    Keine Feiertage oder Schließtage konfiguriert.
                  </td>
                </tr>
              ) : (
                closedDays.map((cd) => (
                  <tr key={cd.id}>
                    <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {new Date(cd.closed_date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </td>
                    <td>{cd.description}</td>
                    <td>
                      <span className={`badge ${cd.is_holiday ? 'badge-info' : 'badge-neutral'}`}>
                        {cd.is_holiday ? 'Feiertag' : 'Schließung'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="btn btn-danger btn-sm btn-icon"
                        type="button"
                        onClick={() => handleDeleteClosedDay(cd.id)}
                        title="Eintrag löschen"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
