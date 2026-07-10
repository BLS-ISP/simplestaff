import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'

// Global event handlers for logging unhandled Promise rejections and script errors in Development
if (import.meta.env.DEV) {
  window.addEventListener('unhandledrejection', (event) => {
    console.group('%c[Unhandled Promise Rejection]', 'color: #ef4444; font-weight: bold;');
    console.error('An unhandled promise rejection occurred:', event.reason);
    console.groupEnd();
  });

  window.addEventListener('error', (event) => {
    console.group('%c[Unhandled Global Error]', 'color: #dc2626; font-weight: bold;');
    console.error('An uncaught scripting error occurred:', event.error || event.message);
    console.groupEnd();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
