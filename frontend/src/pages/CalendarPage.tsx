import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { Employee, PaginatedResponse } from '../types';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../hooks/useAuth';

interface EmployeeSubState {
  loading: boolean;
  url: string | null;
  copied: boolean;
  showQr: boolean;
}

export default function CalendarPage() {
  const { t: _t } = useTranslation();
  const { user } = useAuth();
  const userRole = user?.role || 'viewer';
  const isEmployee = userRole === 'viewer';

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subStates, setSubStates] = useState<Record<string, EmployeeSubState>>({});

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      setError(null);
      if (isEmployee) {
        const emp = await api.employees.getMe();
        setEmployees([emp]);

        // Auto-generate subscription token for employee
        try {
          const { token } = await api.calendar.generateSubscriptionToken(emp.id);
          const url = api.calendar.getSubscriptionUrl(token);
          setSubStates({
            [emp.id]: { loading: false, url, copied: false, showQr: true }
          });
        } catch (err) {
          console.error('Failed to auto-generate employee calendar token:', err);
        }
      } else {
        const response: PaginatedResponse<Employee> = await api.employees.list({ is_active: true });
        setEmployees(response.data);
      }
    } catch (err) {
      setError('Fehler beim Laden der Mitarbeiter.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadIcs = (employeeId: string) => {
    const url = api.calendar.getIcsUrl(employeeId);
    window.open(url, '_blank');
  };

  const handleGenerateSubscription = async (employeeId: string) => {
    setSubStates((prev) => ({
      ...prev,
      [employeeId]: { loading: true, url: null, copied: false, showQr: false },
    }));

    try {
      const { token } = await api.calendar.generateSubscriptionToken(employeeId);
      const url = api.calendar.getSubscriptionUrl(token);
      setSubStates((prev) => ({
        ...prev,
        [employeeId]: { loading: false, url, copied: false, showQr: false },
      }));
    } catch (err) {
      console.error(err);
      setSubStates((prev) => ({
        ...prev,
        [employeeId]: { loading: false, url: null, copied: false, showQr: false },
      }));
    }
  };

  const toggleQr = (employeeId: string) => {
    setSubStates((prev) => ({
      ...prev,
      [employeeId]: {
        ...prev[employeeId],
        showQr: !prev[employeeId]?.showQr,
      },
    }));
  };

  const handleCopy = async (employeeId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setSubStates((prev) => ({
        ...prev,
        [employeeId]: { ...prev[employeeId], copied: true },
      }));
      setTimeout(() => {
        setSubStates((prev) => ({
          ...prev,
          [employeeId]: { ...prev[employeeId], copied: false },
        }));
      }, 2000);
    } catch (err) {
      console.error('Kopieren fehlgeschlagen:', err);
    }
  };

  const getEmployeeName = (emp: Employee): string => {
    const parts = [emp.first_name, emp.last_name].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : emp.email || 'Unbenannt';
  };

  if (loading) {
    return (
      <div className="animate-fade-in" style={{ padding: 'var(--space-xl)' }}>
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="skeleton" style={{ width: '320px', height: '32px', marginBottom: 'var(--space-sm)' }} />
          <div className="skeleton-text" style={{ width: '240px' }} />
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 'var(--space-lg)',
        }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-card" style={{ height: '180px' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ padding: 'var(--space-xl)', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <h1 style={{
          fontSize: '1.75rem',
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 'var(--space-xs)',
        }}>
          📅 Kalender-Abonnement
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          Exportiere oder abonniere Schichtpläne als Kalender-Feed für deine Lieblings-App.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="glass-card" style={{
          padding: 'var(--space-md)',
          marginBottom: 'var(--space-lg)',
          background: 'var(--danger-bg)',
          borderColor: 'var(--danger)',
        }}>
          <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>
        </div>
      )}

      {/* Empty State */}
      {!error && employees.length === 0 && (
        <div className="glass-card animate-slide-up" style={{
          padding: 'var(--space-2xl)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>📥</div>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space-sm)' }}>
            Keine aktiven Mitarbeiter
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Es sind keine aktiven Mitarbeiter vorhanden, für die ein Kalender erstellt werden kann.
          </p>
        </div>
      )}

      {/* Employee Cards Grid */}
      {employees.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 'var(--space-lg)',
          marginBottom: 'var(--space-2xl)',
        }}>
          {employees.map((emp) => {
            const state = subStates[emp.id];
            return (
              <div key={emp.id} className="glass-card animate-slide-up" style={{ padding: 'var(--space-lg)' }}>
                {/* Employee Name */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-sm)',
                  marginBottom: 'var(--space-md)',
                }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--gradient-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    flexShrink: 0,
                  }}>
                    {(emp.first_name?.[0] || emp.email?.[0] || '?').toUpperCase()}
                  </div>
                  <div>
                    <h3 style={{
                      margin: 0,
                      fontSize: '1.05rem',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                    }}>
                      {getEmployeeName(emp)}
                    </h3>
                    {emp.email && (
                      <p style={{
                        margin: 0,
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                      }}>
                        {emp.email}
                      </p>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{
                  display: 'flex',
                  gap: 'var(--space-sm)',
                  marginBottom: state?.url ? 'var(--space-md)' : 0,
                }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleDownloadIcs(emp.id)}
                    style={{ flex: 1 }}
                  >
                    📥 ICS herunterladen
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleGenerateSubscription(emp.id)}
                    disabled={state?.loading}
                    style={{ flex: 1 }}
                  >
                    {state?.loading ? '⌛ Generiere…' : '🔗 Abo-Link generieren'}
                  </button>
                </div>

                {/* Subscription URL */}
                {state?.url && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                    <div className="animate-fade-in" style={{
                      display: 'flex',
                      gap: 'var(--space-xs)',
                      alignItems: 'center',
                    }}>
                      <input
                        className="input"
                        type="text"
                        readOnly
                        value={state.url}
                        style={{
                          flex: 1,
                          fontSize: '0.8rem',
                          fontFamily: 'monospace',
                        }}
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                      <button
                        className={`btn btn-sm ${state.copied ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => handleCopy(emp.id, state.url!)}
                        style={{ whiteSpace: 'nowrap', minWidth: '80px' }}
                      >
                        {state.copied ? '✅ Kopiert!' : '📋 Kopieren'}
                      </button>
                      <button
                        className={`btn btn-sm ${state.showQr ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => toggleQr(emp.id)}
                        style={{ padding: '6px 10px', fontSize: '1rem' }}
                        title="QR-Code anzeigen"
                        type="button"
                      >
                        📷
                      </button>
                    </div>

                    {/* QR Code Container */}
                    {state.showQr && (
                      <div className="animate-slide-up" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 'var(--space-sm)',
                        padding: 'var(--space-md)',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-primary)',
                        borderRadius: 'var(--radius-md)',
                        textAlign: 'center',
                      }}>
                        <div style={{
                          padding: '12px',
                          background: '#fff',
                          borderRadius: 'var(--radius-sm)',
                          display: 'inline-flex',
                          boxShadow: 'var(--shadow-sm)',
                        }}>
                          <QRCodeSVG
                            value={state.url.replace(/^https?:\/\//, 'webcal://')}
                            size={140}
                            level="M"
                            includeMargin={false}
                          />
                        </div>
                        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          Scanne den QR-Code mit deinem Smartphone, um das Kalenderabonnement direkt einzurichten (<strong>webcal</strong>). Apple iOS erkennt den Link automatisch.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Instructions Section */}
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <h2 style={{
          fontSize: '1.3rem',
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 'var(--space-lg)',
        }}>
          📖 Einrichtungsanleitungen
        </h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 'var(--space-lg)',
        }}>
          {/* Android / Google Calendar */}
          <div className="glass-card animate-slide-up" style={{ padding: 'var(--space-lg)' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              marginBottom: 'var(--space-md)',
            }}>
              <span style={{ fontSize: '1.5rem' }}>🤖</span>
              <h3 style={{
                margin: 0,
                fontSize: '1.05rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}>
                Android / Google Kalender
              </h3>
            </div>
            <ol style={{
              margin: 0,
              paddingLeft: 'var(--space-lg)',
              color: 'var(--text-secondary)',
              fontSize: '0.9rem',
              lineHeight: 1.7,
            }}>
              <li>Abo-Link oben generieren und kopieren</li>
              <li>Google Kalender öffnen (Web oder App)</li>
              <li>„Weitere Kalender" → „Per URL"</li>
              <li>Den kopierten Link einfügen</li>
              <li>„Kalender hinzufügen" bestätigen</li>
            </ol>
            <div className="badge badge-info" style={{ marginTop: 'var(--space-md)' }}>
              Automatische Synchronisation
            </div>
          </div>

          {/* Outlook */}
          <div className="glass-card animate-slide-up" style={{ padding: 'var(--space-lg)' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              marginBottom: 'var(--space-md)',
            }}>
              <span style={{ fontSize: '1.5rem' }}>✉️</span>
              <h3 style={{
                margin: 0,
                fontSize: '1.05rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}>
                Outlook
              </h3>
            </div>
            <ol style={{
              margin: 0,
              paddingLeft: 'var(--space-lg)',
              color: 'var(--text-secondary)',
              fontSize: '0.9rem',
              lineHeight: 1.7,
            }}>
              <li>Abo-Link oben generieren und kopieren</li>
              <li>Outlook öffnen → Kalenderansicht</li>
              <li>„Kalender hinzufügen" → „Aus dem Internet abonnieren"</li>
              <li>Den kopierten Link einfügen</li>
              <li>Namen vergeben und bestätigen</li>
            </ol>
            <div className="badge badge-info" style={{ marginTop: 'var(--space-md)' }}>
              Desktop &amp; Web
            </div>
          </div>

          {/* Apple Calendar */}
          <div className="glass-card animate-slide-up" style={{ padding: 'var(--space-lg)' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              marginBottom: 'var(--space-md)',
            }}>
              <span style={{ fontSize: '1.5rem' }}>🍎</span>
              <h3 style={{
                margin: 0,
                fontSize: '1.05rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}>
                Apple Kalender
              </h3>
            </div>
            <ol style={{
              margin: 0,
              paddingLeft: 'var(--space-lg)',
              color: 'var(--text-secondary)',
              fontSize: '0.9rem',
              lineHeight: 1.7,
            }}>
              <li>Abo-Link oben generieren und kopieren</li>
              <li>Apple Kalender öffnen (Mac/iPhone/iPad)</li>
              <li>„Ablage" → „Neues Kalenderabonnement" (Mac) oder Einstellungen → Kalender → Accounts → Abo (iOS)</li>
              <li>Den kopierten Link einfügen</li>
              <li>Synchronisationsintervall wählen und abonnieren</li>
            </ol>
            <div className="badge badge-info" style={{ marginTop: 'var(--space-md)' }}>
              iCloud-Sync
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
