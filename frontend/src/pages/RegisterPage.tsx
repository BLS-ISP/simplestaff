// ============================================
// Register Page
// ============================================

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';

export default function RegisterPage() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    tenant_name: '',
    tenant_slug: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Auto-generate slug from tenant name
    if (field === 'tenant_name') {
      const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      setForm((prev) => ({ ...prev, tenant_name: value, tenant_slug: slug }));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container animate-slide-up">
        <div className="auth-logo">
          <div className="auth-logo-icon">S</div>
          <h1>
            Simple<span className="text-gradient">Staff</span>
          </h1>
          <p className="text-secondary">{t('auth.register')}</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-error">{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="first_name">{t('auth.firstName')}</label>
              <input
                id="first_name"
                type="text"
                value={form.first_name}
                onChange={(e) => updateField('first_name', e.target.value)}
                required
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="last_name">{t('auth.lastName')}</label>
              <input
                id="last_name"
                type="text"
                value={form.last_name}
                onChange={(e) => updateField('last_name', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="reg-email">{t('auth.email')}</label>
            <input
              id="reg-email"
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              placeholder="mail@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="reg-password">{t('auth.password')}</label>
            <input
              id="reg-password"
              type="password"
              value={form.password}
              onChange={(e) => updateField('password', e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
            />
          </div>

          <div className="form-group">
            <label htmlFor="tenant_name">{t('auth.tenantName')}</label>
            <input
              id="tenant_name"
              type="text"
              value={form.tenant_name}
              onChange={(e) => updateField('tenant_name', e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="tenant_slug">{t('auth.tenantSlug')}</label>
            <input
              id="tenant_slug"
              type="text"
              value={form.tenant_slug}
              onChange={(e) => updateField('tenant_slug', e.target.value)}
              required
              pattern="[a-z0-9-]+"
            />
            <span className="form-hint">
              {form.tenant_slug && `URL: /${form.tenant_slug}`}
            </span>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg w-full"
            disabled={loading}
          >
            {loading ? (
              <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
            ) : (
              t('auth.registerButton')
            )}
          </button>

          <p className="auth-switch">
            {t('auth.hasAccount')}{' '}
            <Link to="/login">{t('auth.login')}</Link>
          </p>
        </form>
      </div>

      <style>{`
        .auth-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-4);
          background: var(--bg-deepest);
          background-image:
            radial-gradient(ellipse at 30% 20%, rgba(99, 102, 241, 0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 70% 80%, rgba(139, 92, 246, 0.06) 0%, transparent 50%);
        }

        .auth-container {
          width: 100%;
          max-width: 460px;
          background: var(--glass-bg-heavy);
          backdrop-filter: var(--glass-blur-heavy);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-xl);
          padding: var(--space-10);
          box-shadow: var(--shadow-xl);
        }

        .auth-logo {
          text-align: center;
          margin-bottom: var(--space-8);
        }

        .auth-logo-icon {
          width: 56px;
          height: 56px;
          border-radius: var(--radius-lg);
          background: var(--accent-gradient);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: var(--fs-2xl);
          font-weight: var(--fw-extrabold);
          color: white;
          margin-bottom: var(--space-4);
          box-shadow: var(--shadow-glow);
        }

        .auth-logo h1 {
          font-size: var(--fs-2xl);
          margin-bottom: var(--space-1);
        }

        .auth-form {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .auth-error {
          padding: var(--space-3);
          background: var(--color-error-bg);
          border: 1px solid var(--color-error-border);
          border-radius: var(--radius-sm);
          color: var(--color-error);
          font-size: var(--fs-sm);
          text-align: center;
        }

        .auth-switch {
          text-align: center;
          color: var(--text-secondary);
          font-size: var(--fs-sm);
          margin-top: var(--space-2);
        }

        .auth-switch a {
          color: var(--text-accent);
          font-weight: var(--fw-semibold);
        }

        .auth-switch a:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
