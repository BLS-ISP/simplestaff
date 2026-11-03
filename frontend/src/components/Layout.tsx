// ============================================
// SimpleStaff Layout Component
// Sidebar navigation + main content area
// ============================================

import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { api } from '../api/client';

const navItems = [
  { path: '/dashboard', icon: '📊', labelKey: 'nav.dashboard', end: true },
  { path: '/employees', icon: '👥', labelKey: 'nav.employees', end: false },
  { path: '/shift-types', icon: '🔄', labelKey: 'nav.shiftTypes', end: false },
  { path: '/shift-plan', icon: '📋', labelKey: 'nav.shiftPlan', end: false },
  { path: '/vacations', icon: '🌴', labelKey: 'nav.vacations', end: false },
  { path: '/shift-swaps', icon: '🔀', labelKey: 'nav.shiftSwaps', end: false },
  { path: '/calendar', icon: '📅', labelKey: 'nav.calendar', end: false },
  { path: '/settings', icon: '⚙️', labelKey: 'nav.settings', end: false },
];

export default function Layout() {
  const { t, i18n } = useTranslation();
  const { user, logout, switchTenant } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [switchingTenant, setSwitchingTenant] = useState(false);
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  const currentLang = i18n.language;
  const userRole = user?.role || 'viewer';

  const filteredNavItems = navItems.filter((item) => {
    if (userRole === 'viewer') {
      return ['/dashboard', '/shift-plan', '/vacations', '/shift-swaps', '/calendar'].includes(item.path);
    }
    return true;
  });

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);
    if (newPassword.length < 8) {
      setPwError('Das neue Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    try {
      setPwLoading(true);
      await api.auth.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPwSuccess('Passwort erfolgreich geändert!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setPwModalOpen(false);
        setPwSuccess(null);
      }, 1500);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Passwortänderung fehlgeschlagen.');
    } finally {
      setPwLoading(false);
    }
  };

  const toggleLanguage = () => {
    const newLang = currentLang === 'de' ? 'en' : 'de';
    i18n.changeLanguage(newLang);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleSwitchTenant = async (targetTenantId: string) => {
    if (!user || targetTenantId === user.tenant_id || switchingTenant) return;
    try {
      setSwitchingTenant(true);
      const switchedUser = await switchTenant(targetTenantId);
      window.location.href = switchedUser.role === 'super_admin' ? '/super-admin' : '/dashboard';
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Mandantenwechsel fehlgeschlagen.');
    } finally {
      setSwitchingTenant(false);
    }
  };

  const superAdminChoice = user?.role !== 'super_admin'
    ? user?.available_tenants?.find((tc) => tc.role === 'super_admin')
    : undefined;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Mobile Menu Toggle */}
      <button
        className="btn btn-ghost mobile-menu-toggle"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label="Toggle menu"
      >
        {mobileMenuOpen ? '✕' : '☰'}
      </button>

      {/* Sidebar Overlay (mobile) */}
      {mobileMenuOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`}>
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">S</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 className="sidebar-logo-text">
              Simple<span className="text-gradient">Staff</span>
            </h1>
            <p className="sidebar-logo-subtitle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.tenant_name ? `🏢 ${user.tenant_name}` : 'Shift Management'}
            </p>
          </div>
        </div>

        {/* Super-Admin Impersonation Banner */}
        {superAdminChoice && (
          <div style={{
            padding: '10px 12px',
            borderBottom: '1px solid rgba(245, 158, 11, 0.35)',
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.16), rgba(234, 88, 12, 0.12))',
          }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#fbbf24', marginBottom: 6 }}>
              🛡️ Support-Modus aktiv
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={switchingTenant}
              onClick={() => handleSwitchTenant(superAdminChoice.tenant_id)}
              style={{
                width: '100%',
                justifyContent: 'center',
                fontSize: '0.78rem',
                padding: '6px 10px',
                borderColor: 'rgba(245, 158, 11, 0.45)',
                color: '#fef3c7',
                background: 'rgba(245, 158, 11, 0.2)',
              }}
            >
              {switchingTenant ? 'Wechsle...' : '⬅️ Zurück zum Super-Admin'}
            </button>
          </div>
        )}

        {/* Multi-Tenant Switcher (shown when user has accounts in multiple tenants) */}
        {user?.available_tenants && user.available_tenants.filter((tc) => tc.role !== 'super_admin').length > 1 && (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--glass-border)', background: 'rgba(99, 102, 241, 0.05)' }}>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: 4 }}>
              🏢 Betrieb wechseln
            </label>
            <select
              className="input"
              value={user.tenant_id}
              disabled={switchingTenant}
              onChange={(e) => handleSwitchTenant(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: '0.82rem', height: 34 }}
            >
              {user.available_tenants.filter((tc) => tc.role !== 'super_admin').map((tc) => (
                <option key={tc.tenant_id} value={tc.tenant_id}>
                  {tc.tenant_name} ({tc.role})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Navigation */}
        <nav className="sidebar-nav">
          {filteredNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                `sidebar-nav-link ${isActive ? 'sidebar-nav-link-active' : ''}`
              }
              onClick={() => setMobileMenuOpen(false)}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span className="sidebar-nav-label">{t(item.labelKey)}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom Section */}
        <div className="sidebar-bottom">
          {/* Language Toggle */}
          <button
            className="sidebar-lang-toggle"
            onClick={toggleLanguage}
            title={currentLang === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}
          >
            <span className="sidebar-lang-flag">
              {currentLang === 'de' ? '🇩🇪' : '🇬🇧'}
            </span>
            <span className="sidebar-lang-label">
              {currentLang === 'de' ? 'Deutsch' : 'English'}
            </span>
          </button>

          <div className="sidebar-divider" />

          {/* User Info */}
          {user && (
            <div className="sidebar-user">
              <div className="sidebar-user-avatar">
                {user.first_name?.[0]}
                {user.last_name?.[0]}
              </div>
              <div className="sidebar-user-info">
                <span className="sidebar-user-name">
                  {user.first_name} {user.last_name}
                </span>
                <span className="sidebar-user-role">
                  {user.role}{user.username ? ` • @${user.username}` : ''}
                </span>
              </div>
            </div>
          )}

          <button
            className="sidebar-logout-btn"
            onClick={() => {
              setPwError(null);
              setPwSuccess(null);
              setPwModalOpen(true);
            }}
            style={{ marginBottom: 4 }}
          >
            <span>🔑</span>
            <span>Passwort ändern</span>
          </button>

          <button className="sidebar-logout-btn" onClick={handleLogout}>
            <span>🚪</span>
            <span>{t('nav.logout')}</span>
          </button>
        </div>
      </aside>

      {/* Password Change Modal */}
      {pwModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setPwModalOpen(false)}
        >
          <div
            className="glass-card"
            style={{ width: '100%', maxWidth: 420, padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.15rem', color: 'var(--text-primary)' }}>
              🔑 Eigenes Passwort ändern
            </h3>
            {pwError && (
              <div style={{ padding: '10px 12px', marginBottom: 12, borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: '0.85rem' }}>
                ⚠️ {pwError}
              </div>
            )}
            {pwSuccess && (
              <div style={{ padding: '10px 12px', marginBottom: 12, borderRadius: 8, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', fontSize: '0.85rem' }}>
                ✅ {pwSuccess}
              </div>
            )}
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Aktuelles Passwort
                </label>
                <input
                  type="password"
                  className="input"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Neues Passwort (mind. 8 Zeichen)
                </label>
                <input
                  type="password"
                  className="input"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Neues Passwort bestätigen
                </label>
                <input
                  type="password"
                  className="input"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setPwModalOpen(false)}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary" disabled={pwLoading}>
                  {pwLoading ? 'Speichere...' : 'Passwort speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="main-content">
        <div className="main-content-inner">
          <Outlet />
        </div>
      </main>

      {/* Scoped Styles */}
      <style>{`
        .mobile-menu-toggle {
          display: none;
          position: fixed;
          top: var(--space-3);
          left: var(--space-3);
          z-index: var(--z-fixed);
          font-size: var(--fs-xl);
          width: 44px;
          height: 44px;
          border-radius: var(--radius-md);
          background: var(--glass-bg-heavy);
          backdrop-filter: var(--glass-blur);
          border: 1px solid var(--glass-border);
        }

        .sidebar-overlay {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          z-index: calc(var(--z-fixed) + 1);
        }

        .sidebar {
          width: var(--sidebar-width);
          min-height: 100vh;
          background: var(--glass-bg-heavy);
          backdrop-filter: var(--glass-blur-heavy);
          border-right: 1px solid var(--glass-border);
          display: flex;
          flex-direction: column;
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          z-index: calc(var(--z-fixed) + 2);
          overflow-y: auto;
          transition: transform var(--transition-slow);
        }

        .sidebar-logo {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-6) var(--space-5);
          border-bottom: 1px solid var(--glass-border);
        }

        .sidebar-logo-icon {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-md);
          background: var(--accent-gradient);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: var(--fs-xl);
          font-weight: var(--fw-extrabold);
          color: white;
          flex-shrink: 0;
          box-shadow: var(--shadow-glow-sm);
        }

        .sidebar-logo-text {
          font-size: var(--fs-lg);
          font-weight: var(--fw-extrabold);
          letter-spacing: -0.03em;
          line-height: 1.2;
          color: var(--text-primary);
        }

        .sidebar-logo-subtitle {
          font-size: var(--fs-xs);
          color: var(--text-tertiary);
          font-weight: var(--fw-medium);
          letter-spacing: 0.02em;
        }

        .sidebar-nav {
          flex: 1;
          padding: var(--space-4) var(--space-3);
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .sidebar-nav-link {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          font-size: var(--fs-base);
          font-weight: var(--fw-medium);
          text-decoration: none;
          transition: all var(--transition-base);
          position: relative;
        }

        .sidebar-nav-link:hover {
          color: var(--text-primary);
          background: rgba(148, 163, 184, 0.08);
        }

        .sidebar-nav-link-active {
          color: var(--text-primary);
          background: rgba(99, 102, 241, 0.12);
          box-shadow: var(--shadow-glow-sm);
        }

        .sidebar-nav-link-active::before {
          content: '';
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 60%;
          background: var(--accent-gradient);
          border-radius: var(--radius-full);
        }

        .sidebar-nav-icon {
          font-size: var(--fs-lg);
          width: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .sidebar-nav-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .sidebar-bottom {
          padding: var(--space-4) var(--space-3);
          border-top: 1px solid var(--glass-border);
        }

        .sidebar-lang-toggle {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          width: 100%;
          padding: var(--space-2) var(--space-3);
          background: transparent;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          font-family: var(--font-family);
          font-size: var(--fs-sm);
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .sidebar-lang-toggle:hover {
          background: rgba(148, 163, 184, 0.08);
          border-color: var(--glass-border-strong);
          color: var(--text-primary);
        }

        .sidebar-lang-flag {
          font-size: var(--fs-md);
        }

        .sidebar-lang-label {
          font-weight: var(--fw-medium);
        }

        .sidebar-divider {
          height: 1px;
          background: var(--glass-border);
          margin: var(--space-3) 0;
        }

        .sidebar-user {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-2) var(--space-3);
          margin-bottom: var(--space-2);
        }

        .sidebar-user-avatar {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-full);
          background: var(--accent-gradient);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: var(--fs-xs);
          font-weight: var(--fw-bold);
          color: white;
          flex-shrink: 0;
          letter-spacing: 0.02em;
        }

        .sidebar-user-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .sidebar-user-name {
          font-size: var(--fs-sm);
          font-weight: var(--fw-semibold);
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .sidebar-user-role {
          font-size: var(--fs-xs);
          color: var(--text-tertiary);
          text-transform: capitalize;
        }

        .sidebar-logout-btn {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          width: 100%;
          padding: var(--space-2) var(--space-3);
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          font-family: var(--font-family);
          font-size: var(--fs-sm);
          font-weight: var(--fw-medium);
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .sidebar-logout-btn:hover {
          background: var(--color-error-bg);
          color: var(--color-error);
        }

        .main-content {
          flex: 1;
          margin-left: var(--sidebar-width);
          min-height: 100vh;
        }

        .main-content-inner {
          padding: var(--space-8);
          max-width: var(--content-max-width);
          margin: 0 auto;
          animation: fadeIn var(--transition-slow) ease;
        }

        /* Responsive */
        @media (max-width: 768px) {
          .mobile-menu-toggle {
            display: flex;
          }

          .sidebar-overlay {
            display: block;
          }

          .sidebar {
            transform: translateX(-100%);
          }

          .sidebar.sidebar-open {
            transform: translateX(0);
          }

          .main-content {
            margin-left: 0;
          }

          .main-content-inner {
            padding: var(--space-4);
            padding-top: calc(var(--space-4) + 56px);
          }
        }

        @media (min-width: 769px) {
          .sidebar-overlay {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
