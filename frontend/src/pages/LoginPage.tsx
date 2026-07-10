// ============================================
// Login Page
// ============================================

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.role === 'super_admin') {
        navigate('/super-admin');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
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
          <p className="text-secondary">{t('auth.login')}</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="email">{t('auth.email')}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mail@example.com"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">{t('auth.password')}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg w-full"
            disabled={loading}
          >
            {loading ? (
              <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
            ) : (
              t('auth.loginButton')
            )}
          </button>

        </form>

        <div className="demo-credentials">
          <p className="demo-title">Demo-Zugänge (zum Ausfüllen klicken):</p>
          <div className="demo-buttons">
            <button
              type="button"
              onClick={() => {
                setEmail('admin@test.local');
                setPassword('admin123');
              }}
              className="demo-btn"
            >
              <span>💼 <strong>Manager:</strong> admin@test.local</span>
              <span className="demo-pw">admin123</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEmail('peter@test.local');
                setPassword('start123');
              }}
              className="demo-btn"
            >
              <span>👥 <strong>Mitarbeiter:</strong> peter@test.local</span>
              <span className="demo-pw">start123</span>
            </button>
          </div>
        </div>
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
          max-width: 420px;
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

        .demo-credentials {
          margin-top: var(--space-6);
          padding-top: var(--space-6);
          border-top: 1px solid var(--glass-border);
        }

        .demo-title {
          font-size: var(--fs-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-secondary);
          margin-bottom: var(--space-3);
          font-weight: var(--fw-semibold);
          text-align: center;
        }

        .demo-buttons {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .demo-btn {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          background: rgba(255, 255, 255, 0.01);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          padding: var(--space-2) var(--space-3);
          color: var(--text-primary);
          font-size: var(--fs-xs);
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
        }

        .demo-btn:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(139, 92, 246, 0.3);
          transform: translateY(-1px);
        }

        .demo-pw {
          font-family: monospace;
          color: var(--text-secondary);
          background: rgba(0, 0, 0, 0.2);
          padding: 2px 6px;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}
