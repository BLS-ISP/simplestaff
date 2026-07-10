// =============================================================================
// SimpleStaff – Main Application Router & Entry Point
// =============================================================================

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './i18n';
import './index.css';

// Layout & Auth Protection Guards
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import EmployeesPage from './pages/EmployeesPage';
import EmployeeDetailPage from './pages/EmployeeDetailPage';
import ShiftTypesPage from './pages/ShiftTypesPage';
import ShiftPlanPage from './pages/ShiftPlanPage';
import ShiftPlanMonthPage from './pages/ShiftPlanMonthPage';
import CalendarPage from './pages/CalendarPage';
import SettingsPage from './pages/SettingsPage';
import SuperAdminPage from './pages/SuperAdminPage';
import VacationsPage from './pages/VacationsPage';
import ShiftSwapsPage from './pages/ShiftSwapsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Auth Routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Protected Dashboard/Management Routes (for tenant members/managers) */}
        <Route element={<ProtectedRoute allowedRoles={['admin', 'planner', 'viewer']} />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/employees/:id" element={<EmployeeDetailPage />} />
            <Route path="/shift-types" element={<ShiftTypesPage />} />
            <Route path="/shift-plan" element={<ShiftPlanPage />} />
            <Route path="/shift-plan/month" element={<ShiftPlanMonthPage />} />
            <Route path="/vacations" element={<VacationsPage />} />
            <Route path="/shift-swaps" element={<ShiftSwapsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>

        {/* Protected Super Admin Panel Route */}
        <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
          <Route path="/super-admin" element={<SuperAdminPage />} />
        </Route>

        {/* Catch-all redirect to dashboard */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
