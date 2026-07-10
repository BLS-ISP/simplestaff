import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.group('%c[React Error Boundary]', 'color: #ef4444; font-weight: bold;');
    console.error('Captured an unhandled component rendering error:', error);
    console.error('Component Stack Trace:', errorInfo.componentStack);
    console.groupEnd();
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'var(--bg-deepest, #0f172a)',
          color: 'var(--text-primary, #f8fafc)',
          fontFamily: 'system-ui, sans-serif'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '560px',
            background: 'var(--glass-bg-heavy, rgba(30, 41, 59, 0.7))',
            backdropFilter: 'blur(20px)',
            border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.08))',
            borderRadius: 'var(--radius-xl, 16px)',
            padding: '40px',
            boxShadow: 'var(--shadow-xl, 0 20px 25px -5px rgb(0 0 0 / 0.3))',
            textAlign: 'center'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
              color: 'var(--color-error, #ef4444)',
              marginBottom: '24px'
            }}>
              ⚠️
            </div>

            <h1 style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              marginBottom: '12px',
              letterSpacing: '-0.025em'
            }}>
              Ein unerwarteter Fehler ist aufgetreten
            </h1>

            <p style={{
              color: 'var(--text-secondary, #94a3b8)',
              fontSize: '0.925rem',
              lineHeight: 1.6,
              marginBottom: '24px'
            }}>
              Beim Rendern dieser Ansicht gab es ein Problem. Dies kann an fehlerhaften Daten liegen.
            </p>

            {this.state.error && (
              <div style={{
                textAlign: 'left',
                background: 'rgba(0, 0, 0, 0.25)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '24px',
                overflowX: 'auto',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                color: '#f87171'
              }}>
                <strong>Error:</strong> {this.state.error.message}
              </div>
            )}

            <button
              onClick={this.handleReload}
              className="btn btn-primary"
              style={{
                background: 'var(--accent-gradient, linear-gradient(135deg, #6366f1, #8b5cf6))',
                border: 'none',
                color: 'white',
                padding: '12px 24px',
                fontWeight: 600,
                cursor: 'pointer',
                borderRadius: '8px',
                boxShadow: 'var(--shadow-glow-sm)'
              }}
            >
              Seite neu laden
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
