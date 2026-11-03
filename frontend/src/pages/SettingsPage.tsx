import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { Tenant, TenantSettings, BreakRule, ClosedDay } from '../types';
import { useAuth } from '../hooks/useAuth';

const DEFAULT_BREAK_RULES: BreakRule[] = [
  { from_hours: 6, break_minutes: 30 },
  { from_hours: 9, break_minutes: 45 },
];

interface IndustryPresetDef {
  id: string;
  label: string;
  lawRef: string;
  desc: string;
  maxDaily: number;
  minRest: number;
  maxWeekly: number;
  maxConsecutiveDays: number;
  maxConsecutiveNights: number;
}

const INDUSTRY_PRESETS: IndustryPresetDef[] = [
  {
    id: 'standard',
    label: '🏢 Standard (Büro & Gewerbe)',
    lawRef: '§§ 3, 5 ArbZG',
    desc: 'Reguläres Arbeitszeitgesetz: max. 10h/Tag, mind. 11h Ruhezeit, max. 6 Tage am Stück.',
    maxDaily: 10,
    minRest: 11,
    maxWeekly: 48,
    maxConsecutiveDays: 6,
    maxConsecutiveNights: 4,
  },
  {
    id: 'gastronomy',
    label: '🍽️ Gastronomie & Hotellerie',
    lawRef: '§ 5 Abs. 2 ArbZG',
    desc: 'Branchenausnahme Gastgewerbe: Verkürzte Ruhezeit von 10h zulässig (Ausgleich innerhalb von 4 Wochen).',
    maxDaily: 10,
    minRest: 10,
    maxWeekly: 48,
    maxConsecutiveDays: 6,
    maxConsecutiveNights: 4,
  },
  {
    id: 'healthcare',
    label: '🏥 Pflege, Klinik & Betreuung',
    lawRef: '§ 5 Abs. 2 ArbZG',
    desc: 'Branchenausnahme Pflege/Krankenhaus: Verkürzte Ruhezeit von 10h bei Schichtwechsel sowie max. 4 Nachtdienste in Folge.',
    maxDaily: 10,
    minRest: 10,
    maxWeekly: 48,
    maxConsecutiveDays: 6,
    maxConsecutiveNights: 4,
  },
  {
    id: 'retail',
    label: '🛒 Einzelhandel & Verkauf',
    lawRef: '§§ 3, 5 ArbZG',
    desc: 'Einzelhandel/Bäckerei: 11h Ruhezeit, max. 10h/Tag, max. 6 Werkstage am Stück.',
    maxDaily: 10,
    minRest: 11,
    maxWeekly: 48,
    maxConsecutiveDays: 6,
    maxConsecutiveNights: 4,
  },
  {
    id: 'emergency',
    label: '🚑 Rettungsdienst / Bereitschaft',
    lawRef: '§ 7 ArbZG',
    desc: 'Tarifliche Arbeitsbereitschaft: Bis zu 12h Tagesarbeitszeit, max. 5 Schichten am Stück.',
    maxDaily: 12,
    minRest: 11,
    maxWeekly: 48,
    maxConsecutiveDays: 5,
    maxConsecutiveNights: 4,
  },
];

export default function SettingsPage() {
  const { t: _t } = useTranslation();
  const { isAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [activeEmployeesCount, setActiveEmployeesCount] = useState<number>(0);

  // Business info
  const [name, setName] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);

  // Work time settings
  const [industryPreset, setIndustryPreset] = useState<string>('standard');
  const [maxDailyHours, setMaxDailyHours] = useState(10);
  const [minRestHours, setMinRestHours] = useState(11);
  const [maxWeeklyHours, setMaxWeeklyHours] = useState(48);
  const [maxConsecutiveDays, setMaxConsecutiveDays] = useState(6);
  const [maxConsecutiveNightShifts, setMaxConsecutiveNightShifts] = useState(4);

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
  const [holidayYear, setHolidayYear] = useState<number>(new Date().getFullYear());
  const [holidayState, setHolidayState] = useState<string>('NW');
  const [holidayImporting, setHolidayImporting] = useState(false);
  const [holidayImportMsg, setHolidayImportMsg] = useState<string | null>(null);

  const handleImportHolidays = async () => {
    try {
      setHolidayImporting(true);
      setClosedDaysError(null);
      setHolidayImportMsg(null);
      const res = await api.closedDays.generateHolidays({
        year: holidayYear,
        state: holidayState,
      });
      setHolidayImportMsg(
        `${res.created_count} Feiertage importiert (${res.skipped_count} bereits vorhanden).`
      );
      await fetchClosedDays();
      setTimeout(() => setHolidayImportMsg(null), 5000);
    } catch (err) {
      setClosedDaysError(err instanceof Error ? err.message : 'Fehler beim Importieren der Feiertage.');
    } finally {
      setHolidayImporting(false);
    }
  };

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
    try {
      setClosedDaysError(null);
      await api.closedDays.delete(id);
      await fetchClosedDays();
    } catch (err) {
      console.error(err);
      setClosedDaysError('Fehler beim Löschen des Eintrags.');
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
      const [data, empRes] = await Promise.all([
        api.tenants.get(),
        api.employees.list({ is_active: true, per_page: 200 }).catch(() => ({ data: [], total: 0, page: 1, per_page: 200 })),
      ]);
      setTenant(data);
      setActiveEmployeesCount(empRes.total ?? empRes.data.length);
      setName(data.name);

      const s = data.settings || {};
      setIndustryPreset(s.industry_preset ?? 'standard');
      setMaxDailyHours(s.max_daily_hours ?? 10);
      setMinRestHours(s.min_rest_hours ?? 11);
      setMaxWeeklyHours(s.max_weekly_hours ?? 48);
      setMaxConsecutiveDays(s.max_consecutive_days ?? 6);
      setMaxConsecutiveNightShifts(s.max_consecutive_night_shifts ?? 4);
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
        industry_preset: industryPreset,
        max_daily_hours: maxDailyHours,
        min_rest_hours: minRestHours,
        max_weekly_hours: maxWeeklyHours,
        max_consecutive_days: maxConsecutiveDays,
        max_consecutive_night_shifts: maxConsecutiveNightShifts,
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

      {/* Section 0: Tarif, Lizenz & Mitarbeiter-Kontingent */}
      {tenant && (
        <div className="glass-card animate-slide-up" style={{
          padding: 'var(--space-lg)',
          marginBottom: 'var(--space-lg)',
          borderLeft: '4px solid var(--accent)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
            <h2 style={{
              fontSize: '1.15rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)',
            }}>
              📊 Tarif, Lizenz & Mitarbeiter-Kontingent
            </h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tenant.settings?.license_note && (
                <span style={{
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: 'rgba(99, 102, 241, 0.15)',
                  color: '#a5b4fc',
                  border: '1px solid rgba(99, 102, 241, 0.35)',
                }}>
                  🏷️ {tenant.settings.license_note}
                </span>
              )}
              <span style={{
                fontSize: '0.76rem',
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: 999,
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#6ee7b7',
                border: '1px solid rgba(16, 185, 129, 0.35)',
              }}>
                📅 {tenant.settings?.license_expires_at
                  ? `Lizenz gültig bis ${new Date(tenant.settings.license_expires_at).toLocaleDateString('de-DE')}`
                  : 'Lizenz unbegrenzt aktiv'}
              </span>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem', marginBottom: 6 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Aktive Mitarbeiter im Dienstplan:</span>
              <strong style={{ color: 'var(--text-primary)' }}>
                {activeEmployeesCount} / {tenant.settings?.max_employees ?? '∞ Unbegrenzt'}
              </strong>
            </div>
            <div style={{
              width: '100%',
              height: 10,
              borderRadius: 999,
              background: 'rgba(148, 163, 184, 0.15)',
              overflow: 'hidden',
            }}>
              {(() => {
                const maxEmp = tenant.settings?.max_employees;
                const pct = maxEmp ? Math.min(100, Math.round((activeEmployeesCount / maxEmp) * 100)) : 25;
                const color = !maxEmp ? '#10b981' : pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#10b981';
                return (
                  <div style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: color,
                    borderRadius: 999,
                    transition: 'width 0.3s ease',
                  }} />
                );
              })()}
            </div>
            {tenant.settings?.max_employees && activeEmployeesCount >= tenant.settings.max_employees && (
              <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: '#f59e0b' }}>
                ⚠️ Dein gebuchtes Mitarbeiterlimit ist ausgeschöpft. Bitte kontaktiere BLS.ISP für eine Kontingenterweiterung.
              </p>
            )}
          </div>
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
          marginBottom: 'var(--space-sm)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
        }}>
          ⚖️ Arbeitszeitregelungen & Branchen-Ausnahmen (ArbZG)
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginBottom: 'var(--space-md)' }}>
          Wähle eine gesetzliche Branchen-Vorlage oder passe die Grenzwerte für den automatischen Scheduler und die Konfliktprüfung individuell an.
        </p>

        {/* Branchen-Presets */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 10,
          marginBottom: 'var(--space-lg)',
        }}>
          {INDUSTRY_PRESETS.map((preset) => {
            const active = industryPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setIndustryPreset(preset.id);
                  setMaxDailyHours(preset.maxDaily);
                  setMinRestHours(preset.minRest);
                  setMaxWeeklyHours(preset.maxWeekly);
                  setMaxConsecutiveDays(preset.maxConsecutiveDays);
                  setMaxConsecutiveNightShifts(preset.maxConsecutiveNights);
                }}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: active ? '2px solid var(--accent)' : '1px solid var(--border-primary)',
                  background: active ? 'rgba(99, 102, 241, 0.14)' : 'rgba(255, 255, 255, 0.02)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text-primary)' }}>
                    {preset.label}
                  </span>
                  <span style={{
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: 'rgba(148, 163, 184, 0.18)',
                    color: 'var(--text-secondary)',
                  }}>
                    {preset.lawRef}
                  </span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  {preset.desc}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
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
              Min. Ruhezeit zwischen Schichten (Std.)
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

          <div className="form-group">
            <label style={{
              display: 'block',
              fontSize: '0.85rem',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-xs)',
            }}>
              Max. Arbeitstage am Stück (§ 11 ArbZG)
            </label>
            <input
              className="input"
              type="number"
              min={1}
              max={14}
              step={1}
              value={maxConsecutiveDays}
              onChange={(e) => setMaxConsecutiveDays(parseInt(e.target.value, 10) || 6)}
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
              Max. Nachtschichten in Folge (§ 6 ArbZG)
            </label>
            <input
              className="input"
              type="number"
              min={1}
              max={14}
              step={1}
              value={maxConsecutiveNightShifts}
              onChange={(e) => setMaxConsecutiveNightShifts(parseInt(e.target.value, 10) || 4)}
            />
          </div>
        </div>

        <div style={{
          marginTop: 'var(--space-md)',
          padding: '10px 14px',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
        }}>
          🛡️ <strong>Hinweis zu besonderen Schutzgruppen (JArbSchG, MuSchG & Minijob):</strong> Für <strong>Jugendliche unter 18 Jahren</strong> (12h Ruhezeit, max. 8h/Tag, 5-Tage-Woche, Nachtarbeitsverbot, erhöhte Pausen), <strong>Schwangere/Stillende (Mutterschutz)</strong> sowie <strong>Minijob-Monatskontingente</strong> kannst du das entsprechende Schutzprofil direkt im jeweiligen <strong>Mitarbeiterprofil</strong> hinterlegen. Der Auto-Scheduler berücksichtigt diese Schutzgesetze automatisch vorrangig.
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
        {holidayImportMsg && (
          <div style={{ color: 'var(--success)', fontSize: '0.9rem', marginBottom: 'var(--space-md)' }}>
            ✅ {holidayImportMsg}
          </div>
        )}

        {/* Automatic Holiday Generator */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-md)',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          marginBottom: 'var(--space-md)',
          background: 'rgba(99, 102, 241, 0.06)',
          padding: 'var(--space-md)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid rgba(99, 102, 241, 0.25)',
        }}>
          <div style={{ flex: '2 1 220px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
              🇩🇪 Bundesland für Feiertags-Import
            </label>
            <select
              className="input"
              value={holidayState}
              onChange={(e) => setHolidayState(e.target.value)}
            >
              <option value="BW">Baden-Württemberg (BW)</option>
              <option value="BY">Bayern (BY)</option>
              <option value="BE">Berlin (BE)</option>
              <option value="BB">Brandenburg (BB)</option>
              <option value="HB">Bremen (HB)</option>
              <option value="HH">Hamburg (HH)</option>
              <option value="HE">Hessen (HE)</option>
              <option value="MV">Mecklenburg-Vorpommern (MV)</option>
              <option value="NI">Niedersachsen (NI)</option>
              <option value="NW">Nordrhein-Westfalen (NW)</option>
              <option value="RP">Rheinland-Pfalz (RP)</option>
              <option value="SL">Saarland (SL)</option>
              <option value="SN">Sachsen (SN)</option>
              <option value="ST">Sachsen-Anhalt (ST)</option>
              <option value="SH">Schleswig-Holstein (SH)</option>
              <option value="TH">Thüringen (TH)</option>
            </select>
          </div>
          <div style={{ flex: '1 1 110px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
              Jahr
            </label>
            <input
              type="number"
              className="input"
              min={2020}
              max={2100}
              value={holidayYear}
              onChange={(e) => setHolidayYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ height: '42px' }}
            onClick={handleImportHolidays}
            disabled={holidayImporting}
          >
            {holidayImporting ? '⏳ Importiere…' : '✨ Gesetzliche Feiertage generieren'}
          </button>
        </div>

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
                      {new Date(cd.closed_date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
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
