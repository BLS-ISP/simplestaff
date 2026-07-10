// ============================================
// SimpleStaff Layout Component
// Sidebar navigation + main content area
// ============================================

import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';

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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentLang = i18n.language;
  const userRole = user?.role || 'viewer';

  const filteredNavItems = navItems.filter((item) => {
    if (userRole === 'viewer') {
      return ['/dashboard', '/vacations', '/shift-swaps', '/calendar'].includes(item.path);
    }
    return true;
  });

  const toggleLanguage = () => {
    const newLang = currentLang === 'de' ? 'en' : 'de';
    i18n.changeLanguage(newLang);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

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
          <div>
            <h1 className="sidebar-logo-text">
              Simple<span className="text-gradient">Staff</span>
            </h1>
            <p className="sidebar-logo-subtitle">Shift Management</p>
          </div>
        </div>

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
                <span className="sidebar-user-role">{user.role}</span>
              </div>
            </div>
          )}

          <button className="sidebar-logout-btn" onClick={handleLogout}>
            <span>🚪</span>
            <span>{t('nav.logout')}</span>
          </button>
        </div>
      </aside>

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
