import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { TenantAdminInfo } from '../api/client';
import { useAuth } from '../hooks/useAuth';

export default function SuperAdminPage() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  const [tenants, setTenants] = useState<TenantAdminInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal States
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantAdminInfo | null>(null);

  // Form Fields - Create Tenant
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [maxEmployees, setMaxEmployees] = useState<number | ''>('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [managerFirstName, setManagerFirstName] = useState('');
  const [managerLastName, setManagerLastName] = useState('');

  // Form Fields - Edit Tenant
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editMaxEmployees, setEditMaxEmployees] = useState<number | ''>('');

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.admin.listTenants();
      setTenants(data);
    } catch (err) {
      setError('Fehler beim Laden der Mandantenliste.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setName('');
    setSlug('');
    setMaxEmployees('');
    setManagerEmail('');
    setManagerPassword('');
    setManagerFirstName('');
    setManagerLastName('');
    setActionError(null);
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (t: TenantAdminInfo) => {
    setEditingTenant(t);
    setEditName(t.name);
    setEditSlug(t.slug);
    setEditMaxEmployees(t.max_employees !== null ? t.max_employees : '');
    setActionError(null);
    setIsEditOpen(true);
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim() || !managerEmail.trim() || !managerPassword.trim()) {
      setActionError('Bitte fülle alle erforderlichen Felder aus.');
      return;
    }

    try {
      setSaving(true);
      setActionError(null);
      await api.admin.createTenant({
        name,
        slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, ''),
        max_employees: maxEmployees === '' ? null : Number(maxEmployees),
        manager_email: managerEmail,
        manager_password: managerPassword,
        manager_first_name: managerFirstName,
        manager_last_name: managerLastName,
      });
      setIsCreateOpen(false);
      fetchTenants();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Mandant konnte nicht erstellt werden.');
    } finally {
      setSaving(false);
    }
  };

  const handleEditTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTenant) return;
    if (!editName.trim() || !editSlug.trim()) {
      setActionError('Betriebsname und Slug sind erforderlich.');
      return;
    }

    try {
      setSaving(true);
      setActionError(null);
      await api.admin.updateTenant(editingTenant.id, {
        name: editName,
        slug: editSlug.toLowerCase().replace(/[^a-z0-9-]/g, ''),
        max_employees: editMaxEmployees === '' ? null : Number(editMaxEmployees),
      });
      setIsEditOpen(false);
      setEditingTenant(null);
      fetchTenants();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Änderungen konnten nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTenant = async (id: string, name: string) => {
    const confirmed = window.confirm(
      `WARNUNG:\nMöchtest du den Mandanten "${name}" wirklich unwiderruflich löschen?\n\nDies löscht ALLE zugehörigen Mitarbeiter, Benutzer, Dienstpläne und Einstellungen dauerhaft aus der Datenbank!`
    );
    if (!confirmed) return;

    try {
      setError(null);
      await api.admin.deleteTenant(id);
      fetchTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mandant konnte nicht gelöscht werden.');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Helper to suggest slug based on name
  const handleNameChange = (val: string) => {
    setName(val);
    // Convert to lowercase alphanumeric and dashes
    const suggestedSlug = val
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    setSlug(suggestedSlug);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Top Header */}
      <header style={{
        background: 'var(--glass-bg-heavy)',
        backdropFilter: 'var(--glass-blur-heavy)',
        borderBottom: '1px solid var(--glass-border)',
        padding: 'var(--space-md) var(--space-xl)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <div style={{
            background: 'var(--gradient-primary)',
            width: '32px',
            height: '32px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '1rem',
            color: '#fff',
          }}>
            S
          </div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
            SimpleStaff <span style={{ color: 'var(--accent)', fontWeight: 500 }}>Super-Admin Panel</span>
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Eingeloggt als: <strong style={{ color: 'var(--text-primary)' }}>{user?.email}</strong>
          </span>
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
            Abmelden
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: 'var(--space-xl)', maxWidth: '1200px', width: '100%', margin: '0 auto' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-xl)',
        }}>
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              🏢 Mandantenverwaltung (Tenants)
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: 'var(--space-xs)' }}>
              Erstelle und verwalte die isolierten Mandanten (Betriebe) des Systems, richte Manager ein und setze Mitarbeiterlimits.
            </p>
          </div>
          <button className="btn btn-primary" onClick={handleOpenCreate}>
            ➕ Neuen Mandanten anlegen
          </button>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="glass-card" style={{
            padding: 'var(--space-md)',
            marginBottom: 'var(--space-lg)',
            background: 'var(--danger-bg)',
            borderColor: 'var(--danger)',
          }}>
            <p style={{ color: 'var(--danger)', margin: 0 }}>❌ {error}</p>
          </div>
        )}

        {/* Loading Spinner */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton-card" style={{ height: '140px' }} />
            ))}
          </div>
        ) : tenants.length === 0 ? (
          <div className="glass-card" style={{ padding: 'var(--space-2xl)', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>🏢</div>
            <h3 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space-sm)' }}>Keine Mandanten gefunden</h3>
            <p style={{ color: 'var(--text-secondary)' }}>Es wurden noch keine Mandanten im System registriert.</p>
          </div>
        ) : (
          /* Tenant Grid List */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {tenants.map((t) => (
              <div key={t.id} className="glass-card animate-slide-up" style={{
                padding: 'var(--space-lg)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 'var(--space-md)',
              }}>
                <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--accent-subtle)',
                    border: '1px solid var(--border-accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.5rem',
                  }}>
                    🏢
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {t.name}
                    </h3>
                    <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      <span>Slug: <strong style={{ color: 'var(--text-secondary)' }}>{t.slug}</strong></span>
                      <span>•</span>
                      <span>Mitarbeiterlimit: <strong style={{ color: t.max_employees ? 'var(--warning)' : 'var(--success)' }}>
                        {t.max_employees !== null ? `${t.max_employees} Mitarbeiter` : 'Unbegrenzt'}
                      </strong></span>
                      <span>•</span>
                      <span>ID: <span style={{ fontFamily: 'monospace' }}>{t.id}</span></span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleOpenEdit(t)}>
                    ✏️ Bearbeiten
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={t.slug === 'system'} // Prevent deleting system tenant
                    onClick={() => handleDeleteTenant(t.id, t.name)}
                  >
                    🗑️ Löschen
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal: Create Tenant */}
      {isCreateOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'var(--glass-blur)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 200,
          padding: 'var(--space-md)',
        }}>
          <div className="glass-card animate-slide-up" style={{
            width: '100%',
            maxWidth: '550px',
            padding: 'var(--space-xl)',
            maxHeight: '90vh',
            overflowY: 'auto',
          }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 'var(--space-lg)', color: 'var(--text-primary)' }}>
              Neuen Mandanten anlegen
            </h3>

            {actionError && (
              <div style={{
                background: 'var(--danger-bg)',
                border: '1px solid var(--danger)',
                padding: 'var(--space-sm)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: 'var(--space-md)',
                color: 'var(--danger)',
                fontSize: '0.85rem',
              }}>
                ❌ {actionError}
              </div>
            )}

            <form onSubmit={handleCreateTenant}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <div className="form-group">
                  <label>Betriebsname *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="z.B. Hotel Adler"
                  />
                </div>
                <div className="form-group">
                  <label>Slug *</label>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="z.B. hotel-adler"
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 'var(--space-lg)' }}>
                <label>Mitarbeiterlimit (Optional)</label>
                <input
                  type="number"
                  min={1}
                  value={maxEmployees}
                  onChange={(e) => setMaxEmployees(e.target.value !== '' ? Number(e.target.value) : '')}
                  placeholder="Leer lassen für unbegrenzt"
                />
              </div>

              <div style={{ borderTop: '1px solid var(--border-secondary)', paddingTop: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 'var(--space-md)', color: 'var(--text-primary)' }}>
                  🔑 Betriebsadministrator (Manager) einrichten
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                  <div className="form-group">
                    <label>Vorname</label>
                    <input
                      type="text"
                      value={managerFirstName}
                      onChange={(e) => setManagerFirstName(e.target.value)}
                      placeholder="Max"
                    />
                  </div>
                  <div className="form-group">
                    <label>Nachname</label>
                    <input
                      type="text"
                      value={managerLastName}
                      onChange={(e) => setManagerLastName(e.target.value)}
                      placeholder="Mustermann"
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                  <div className="form-group">
                    <label>Manager-E-Mail *</label>
                    <input
                      type="email"
                      required
                      value={managerEmail}
                      onChange={(e) => setManagerEmail(e.target.value)}
                      placeholder="admin@hotel-adler.de"
                    />
                  </div>
                  <div className="form-group">
                    <label>Manager-Passwort *</label>
                    <input
                      type="password"
                      required
                      value={managerPassword}
                      onChange={(e) => setManagerPassword(e.target.value)}
                      placeholder="Sicheres Passwort"
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', marginTop: 'var(--space-lg)' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsCreateOpen(false)} disabled={saving}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Erstelle...' : 'Mandant erstellen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Tenant */}
      {isEditOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'var(--glass-blur)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 200,
          padding: 'var(--space-md)',
        }}>
          <div className="glass-card animate-slide-up" style={{
            width: '100%',
            maxWidth: '500px',
            padding: 'var(--space-xl)',
          }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 'var(--space-lg)', color: 'var(--text-primary)' }}>
              Mandant bearbeiten
            </h3>

            {actionError && (
              <div style={{
                background: 'var(--danger-bg)',
                border: '1px solid var(--danger)',
                padding: 'var(--space-sm)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: 'var(--space-md)',
                color: 'var(--danger)',
                fontSize: '0.85rem',
              }}>
                ❌ {actionError}
              </div>
            )}

            <form onSubmit={handleEditTenant}>
              <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
                <label>Betriebsname *</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
                <label>Slug *</label>
                <input
                  type="text"
                  required
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 'var(--space-lg)' }}>
                <label>Mitarbeiterlimit (Optional)</label>
                <input
                  type="number"
                  min={1}
                  value={editMaxEmployees}
                  onChange={(e) => setEditMaxEmployees(e.target.value !== '' ? Number(e.target.value) : '')}
                  placeholder="Leer lassen für unbegrenzt"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsEditOpen(false)} disabled={saving}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Speichere...' : 'Speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
