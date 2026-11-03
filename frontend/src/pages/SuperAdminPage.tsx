import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { TenantAdminInfo, TenantUserAdminInfo } from '../api/client';
import { useAuth } from '../hooks/useAuth';

type StatusFilter = 'all' | 'active' | 'suspended' | 'limit_warning' | 'license_warning';
type SortBy = 'created_desc' | 'name_asc' | 'employees_desc';

function isLicenseExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const today = new Date().toISOString().slice(0, 10);
  return expiresAt < today;
}

function isLicenseExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const today = new Date();
  const exp = new Date(`${expiresAt}T00:00:00`);
  if (isNaN(exp.getTime())) return false;
  const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 30;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function SuperAdminPage() {
  const { logout, user, impersonateTenant } = useAuth();
  const navigate = useNavigate();

  const [tenants, setTenants] = useState<TenantAdminInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  // Search, Filter & Sort
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('created_desc');

  // Modal States - Create & Edit Tenant
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantAdminInfo | null>(null);

  // Form Fields - Create Tenant
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [maxEmployees, setMaxEmployees] = useState<number | ''>('');
  const [licenseNote, setLicenseNote] = useState('');
  const [licenseExpiresAt, setLicenseExpiresAt] = useState('');
  const [seedDefaultShifts, setSeedDefaultShifts] = useState(true);
  const [managerEmail, setManagerEmail] = useState('');
  const [managerUsername, setManagerUsername] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [managerFirstName, setManagerFirstName] = useState('');
  const [managerLastName, setManagerLastName] = useState('');
  const [createManagerEmployee, setCreateManagerEmployee] = useState(true);
  const [managerWeeklyHours, setManagerWeeklyHours] = useState<number>(40);
  const [managerVacationDays, setManagerVacationDays] = useState<number>(30);

  // Form Fields - Edit Tenant
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editMaxEmployees, setEditMaxEmployees] = useState<number | ''>('');
  const [editLicenseNote, setEditLicenseNote] = useState('');
  const [editLicenseExpiresAt, setEditLicenseExpiresAt] = useState('');
  const [editIsSuspended, setEditIsSuspended] = useState(false);
  const [editSuspensionReason, setEditSuspensionReason] = useState('');

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modal State - Tenant Users Management
  const [usersModalTenant, setUsersModalTenant] = useState<TenantAdminInfo | null>(null);
  const [tenantUsers, setTenantUsers] = useState<TenantUserAdminInfo[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersSuccess, setUsersSuccess] = useState<string | null>(null);

  // Edit Single Tenant User State
  const [editingUser, setEditingUser] = useState<TenantUserAdminInfo | null>(null);
  const [editUserEmail, setEditUserEmail] = useState('');
  const [editUserUsername, setEditUserUsername] = useState('');
  const [editUserFirstName, setEditUserFirstName] = useState('');
  const [editUserLastName, setEditUserLastName] = useState('');
  const [editUserRole, setEditUserRole] = useState('admin');
  const [editUserActive, setEditUserActive] = useState(true);
  const [editUserPassword, setEditUserPassword] = useState('');
  const [userSaving, setUserSaving] = useState(false);

  // Create New Tenant User State
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserUsername, setNewUserUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserFirstName, setNewUserFirstName] = useState('');
  const [newUserLastName, setNewUserLastName] = useState('');
  const [newUserRole, setNewUserRole] = useState('admin');
  const [newUserCreateEmployee, setNewUserCreateEmployee] = useState(false);
  const [newUserWeeklyHours, setNewUserWeeklyHours] = useState(40);
  const [newUserVacationDays, setNewUserVacationDays] = useState(30);

  // Super-Admin Own Password Change Modal
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

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

  // KPIs Calculation
  const kpis = useMemo(() => {
    const customerTenants = tenants.filter((t) => t.slug !== 'system');
    const suspendedCount = customerTenants.filter((t) => t.is_suspended).length;
    const activeTenantsCount = customerTenants.length - suspendedCount;
    const totalActiveEmployees = tenants.reduce((acc, t) => acc + t.active_employees_count, 0);
    const totalAllEmployees = tenants.reduce((acc, t) => acc + t.total_employees_count, 0);
    const totalUsers = tenants.reduce((acc, t) => acc + t.users_count, 0);
    const licenseIssuesCount = customerTenants.filter(
      (t) => isLicenseExpired(t.license_expires_at) || isLicenseExpiringSoon(t.license_expires_at)
    ).length;
    const limitWarningCount = customerTenants.filter(
      (t) => t.max_employees && t.active_employees_count / t.max_employees >= 0.8
    ).length;

    return {
      totalTenants: customerTenants.length,
      activeTenantsCount,
      suspendedCount,
      totalActiveEmployees,
      totalAllEmployees,
      totalUsers,
      licenseIssuesCount,
      limitWarningCount,
    };
  }, [tenants]);

  // Filtered & Sorted Tenants
  const filteredTenants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tenants
      .filter((t) => {
        if (statusFilter === 'active' && (t.is_suspended || isLicenseExpired(t.license_expires_at))) {
          return false;
        }
        if (statusFilter === 'suspended' && !t.is_suspended) {
          return false;
        }
        if (statusFilter === 'limit_warning') {
          if (!t.max_employees || t.active_employees_count / t.max_employees < 0.8) return false;
        }
        if (statusFilter === 'license_warning') {
          if (!isLicenseExpired(t.license_expires_at) && !isLicenseExpiringSoon(t.license_expires_at)) {
            return false;
          }
        }
        if (!q) return true;

        const matchBasic =
          t.name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          (t.license_note && t.license_note.toLowerCase().includes(q));
        const matchAdmins = t.admins.some(
          (a) =>
            a.email.toLowerCase().includes(q) ||
            (a.username && a.username.toLowerCase().includes(q)) ||
            `${a.first_name} ${a.last_name}`.toLowerCase().includes(q)
        );
        return matchBasic || matchAdmins;
      })
      .sort((a, b) => {
        // Keep system tenant at the bottom
        if (a.slug === 'system' && b.slug !== 'system') return 1;
        if (b.slug === 'system' && a.slug !== 'system') return -1;

        if (sortBy === 'name_asc') {
          return a.name.localeCompare(b.name, 'de');
        }
        if (sortBy === 'employees_desc') {
          return b.active_employees_count - a.active_employees_count;
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [tenants, searchQuery, statusFilter, sortBy]);

  const handleOpenCreate = () => {
    setName('');
    setSlug('');
    setMaxEmployees('');
    setLicenseNote('');
    setLicenseExpiresAt('');
    setSeedDefaultShifts(true);
    setManagerEmail('');
    setManagerUsername('');
    setManagerPassword('');
    setManagerFirstName('');
    setManagerLastName('');
    setCreateManagerEmployee(true);
    setManagerWeeklyHours(40);
    setManagerVacationDays(30);
    setActionError(null);
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (t: TenantAdminInfo) => {
    setEditingTenant(t);
    setEditName(t.name);
    setEditSlug(t.slug);
    setEditMaxEmployees(t.max_employees !== null ? t.max_employees : '');
    setEditLicenseNote(t.license_note || '');
    setEditLicenseExpiresAt(t.license_expires_at || '');
    setEditIsSuspended(t.is_suspended);
    setEditSuspensionReason(t.suspension_reason || '');
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
        license_note: licenseNote.trim() || null,
        license_expires_at: licenseExpiresAt.trim() || null,
        seed_default_shifts: seedDefaultShifts,
        manager_email: managerEmail,
        manager_username: managerUsername.trim() || undefined,
        manager_password: managerPassword,
        manager_first_name: managerFirstName,
        manager_last_name: managerLastName,
        create_manager_employee: createManagerEmployee,
        manager_weekly_hours: managerWeeklyHours,
        manager_vacation_days: managerVacationDays,
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
        is_suspended: editIsSuspended,
        suspension_reason: editSuspensionReason.trim() || null,
        license_note: editLicenseNote.trim() || null,
        license_expires_at: editLicenseExpiresAt.trim() || null,
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

  const handleQuickToggleSuspend = async (t: TenantAdminInfo) => {
    if (t.slug === 'system') return;
    const nextSuspended = !t.is_suspended;
    let reason = t.suspension_reason || '';
    if (nextSuspended) {
      const promptReason = window.prompt(
        `Mandant "${t.name}" sperren/pausieren?\nBenutzer dieses Mandanten können sich während der Sperre nicht einloggen.\n\nOptionaler Sperrgrund (wird beim Login angezeigt):`,
        reason || 'Wartungsarbeiten / Zahlungsverzug'
      );
      if (promptReason === null) return;
      reason = promptReason;
    } else {
      const ok = window.confirm(`Mandant "${t.name}" wieder freigeben?`);
      if (!ok) return;
      reason = '';
    }

    try {
      setError(null);
      await api.admin.updateTenant(t.id, {
        name: t.name,
        slug: t.slug,
        max_employees: t.max_employees,
        is_suspended: nextSuspended,
        suspension_reason: reason.trim() || null,
        license_note: t.license_note,
        license_expires_at: t.license_expires_at,
      });
      fetchTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status konnte nicht geändert werden.');
    }
  };

  const handleDeleteTenant = async (id: string, tenantName: string) => {
    const confirmed = window.confirm(
      `WARNUNG:\nMöchtest du den Mandanten "${tenantName}" wirklich unwiderruflich löschen?\n\nDies löscht ALLE zugehörigen Mitarbeiter, Benutzer, Dienstpläne und Einstellungen dauerhaft aus der Datenbank!`
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

  const handleImpersonate = async (t: TenantAdminInfo) => {
    try {
      setImpersonatingId(t.id);
      setError(null);
      await impersonateTenant(t.id);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Support-Login fehlgeschlagen.');
    } finally {
      setImpersonatingId(null);
    }
  };

  // --- Tenant Users Management Modal Handlers ---
  const handleOpenUsersModal = async (t: TenantAdminInfo) => {
    setUsersModalTenant(t);
    setEditingUser(null);
    setShowAddUserForm(false);
    setUsersError(null);
    setUsersSuccess(null);
    await loadTenantUsers(t.id);
  };

  const loadTenantUsers = async (tenantId: string) => {
    try {
      setUsersLoading(true);
      setUsersError(null);
      const list = await api.admin.listTenantUsers(tenantId);
      setTenantUsers(list);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Benutzerliste konnte nicht geladen werden.');
    } finally {
      setUsersLoading(false);
    }
  };

  const handleStartEditUser = (u: TenantUserAdminInfo) => {
    setShowAddUserForm(false);
    setEditingUser(u);
    setEditUserEmail(u.email);
    setEditUserUsername(u.username || '');
    setEditUserFirstName(u.first_name);
    setEditUserLastName(u.last_name);
    setEditUserRole(u.role === 'super_admin' ? 'admin' : u.role);
    setEditUserActive(u.is_active);
    setEditUserPassword('');
    setUsersError(null);
    setUsersSuccess(null);
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usersModalTenant || !editingUser) return;
    try {
      setUserSaving(true);
      setUsersError(null);
      setUsersSuccess(null);
      await api.admin.updateTenantUser(usersModalTenant.id, editingUser.id, {
        email: editUserEmail.trim(),
        username: editUserUsername.trim(),
        first_name: editUserFirstName.trim(),
        last_name: editUserLastName.trim(),
        role: editUserRole,
        is_active: editUserActive,
        password: editUserPassword.trim() ? editUserPassword.trim() : undefined,
      });
      setUsersSuccess(`Benutzer "${editUserEmail}" wurde aktualisiert.`);
      setEditingUser(null);
      await loadTenantUsers(usersModalTenant.id);
      fetchTenants();
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Benutzer konnte nicht aktualisiert werden.');
    } finally {
      setUserSaving(false);
    }
  };

  const handleEnsureEmployeeProfile = async (u: TenantUserAdminInfo) => {
    if (!usersModalTenant) return;
    try {
      setUserSaving(true);
      setUsersError(null);
      setUsersSuccess(null);
      await api.admin.updateTenantUser(usersModalTenant.id, u.id, {
        ensure_employee_profile: true,
      });
      setUsersSuccess(`Mitarbeiterprofil für "${u.first_name} ${u.last_name}" wurde verknüpft/erstellt.`);
      await loadTenantUsers(usersModalTenant.id);
      fetchTenants();
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Mitarbeiterprofil konnte nicht erstellt werden.');
    } finally {
      setUserSaving(false);
    }
  };

  const handleCreateTenantUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usersModalTenant) return;
    try {
      setUserSaving(true);
      setUsersError(null);
      setUsersSuccess(null);
      await api.admin.createTenantUser(usersModalTenant.id, {
        email: newUserEmail.trim(),
        username: newUserUsername.trim() || undefined,
        password: newUserPassword,
        first_name: newUserFirstName.trim(),
        last_name: newUserLastName.trim(),
        role: newUserRole,
        create_employee_profile: newUserCreateEmployee,
        weekly_hours: newUserWeeklyHours,
        vacation_days: newUserVacationDays,
      });
      setUsersSuccess(`Benutzer "${newUserEmail}" wurde erfolgreich angelegt.`);
      setShowAddUserForm(false);
      setNewUserEmail('');
      setNewUserUsername('');
      setNewUserPassword('');
      setNewUserFirstName('');
      setNewUserLastName('');
      setNewUserRole('admin');
      setNewUserCreateEmployee(false);
      await loadTenantUsers(usersModalTenant.id);
      fetchTenants();
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Benutzer konnte nicht angelegt werden.');
    } finally {
      setUserSaving(false);
    }
  };

  const handleDeleteTenantUser = async (u: TenantUserAdminInfo) => {
    if (!usersModalTenant) return;
    const ok = window.confirm(
      `Möchtest du den Benutzer-Login "${u.first_name} ${u.last_name}" (${u.email}) wirklich löschen?\n(Ein eventuell verknüpftes Mitarbeiterprofil im Dienstplan bleibt erhalten.)`
    );
    if (!ok) return;

    try {
      setUserSaving(true);
      setUsersError(null);
      setUsersSuccess(null);
      await api.admin.deleteTenantUser(usersModalTenant.id, u.id);
      setUsersSuccess(`Benutzer "${u.email}" wurde gelöscht.`);
      if (editingUser?.id === u.id) setEditingUser(null);
      await loadTenantUsers(usersModalTenant.id);
      fetchTenants();
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Benutzer konnte nicht gelöscht werden.');
    } finally {
      setUserSaving(false);
    }
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleNameChange = (val: string) => {
    setName(val);
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
        padding: '14px 28px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            background: 'var(--accent-gradient)',
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: '1.1rem',
            color: '#fff',
            boxShadow: 'var(--shadow-glow-sm)',
          }}>
            S
          </div>
          <div>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
              SimpleStaff <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Super-Admin Control Center</span>
            </h1>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              Mandanten-, Lizenz- & Master-Account-Verwaltung
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginRight: 4 }}>
            🛡️ <strong style={{ color: 'var(--text-primary)' }}>{user?.email}</strong>
            {user?.username && <span style={{ color: 'var(--text-tertiary)' }}> (@{user.username})</span>}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setPwError(null);
              setPwSuccess(null);
              setPwModalOpen(true);
            }}
          >
            🔑 Passwort ändern
          </button>
          <button className="btn btn-secondary btn-sm" onClick={fetchTenants} title="Aktualisieren">
            🔄 Aktualisieren
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
            🚪 Abmelden
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '28px', maxWidth: '1320px', width: '100%', margin: '0 auto' }}>
        {/* KPI Dashboard Row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          gap: '16px',
          marginBottom: '28px',
        }}>
          <div className="glass-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              🏢 Kunden-Mandanten
            </div>
            <div style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
              {kpis.totalTenants}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 4, display: 'flex', gap: 10 }}>
              <span style={{ color: '#10b981' }}>● {kpis.activeTenantsCount} Aktiv</span>
              {kpis.suspendedCount > 0 && (
                <span style={{ color: '#ef4444' }}>● {kpis.suspendedCount} Gesperrt</span>
              )}
            </div>
          </div>

          <div className="glass-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              👥 Aktive Mitarbeiter (Systemweit)
            </div>
            <div style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
              {kpis.totalActiveEmployees}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
              Gesamt inkl. Inaktive: {kpis.totalAllEmployees}
            </div>
          </div>

          <div className="glass-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              🔐 Benutzer-Accounts
            </div>
            <div style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
              {kpis.totalUsers}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
              Über alle Mandanten hinweg
            </div>
          </div>

          <div className="glass-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              📊 Kontingente & Lizenzen
            </div>
            <div style={{ fontSize: '1.9rem', fontWeight: 800, color: kpis.licenseIssuesCount + kpis.limitWarningCount > 0 ? '#f59e0b' : '#10b981', marginTop: 6 }}>
              {kpis.licenseIssuesCount + kpis.limitWarningCount === 0 ? 'Alles OK' : `${kpis.licenseIssuesCount + kpis.limitWarningCount} Hinweise`}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
              {kpis.limitWarningCount} Limit ≥80% • {kpis.licenseIssuesCount} Lizenz-Hinweise
            </div>
          </div>
        </div>

        {/* Title & Create Button */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          marginBottom: '20px',
        }}>
          <div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              🏢 Mandanten & Betriebe verwalten
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '4px 0 0 0' }}>
              Direkter Support-Login in jeden Betrieb, Verwaltung von Master-Accounts, Mitarbeiterlimits, Sperren und Lizenzen.
            </p>
          </div>
          <button className="btn btn-primary" onClick={handleOpenCreate}>
            ➕ Neuen Mandanten anlegen
          </button>
        </div>

        {/* Search, Filter & Sort Bar */}
        <div className="glass-card" style={{
          padding: '14px 18px',
          marginBottom: '20px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ flex: '1 1 280px', minWidth: '240px' }}>
            <input
              type="text"
              className="input"
              placeholder="🔍 Suche nach Betrieb, Slug, Admin-E-Mail, @Benutzername oder Vertragsnotiz..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            {([
              ['all', `Alle (${tenants.length})`],
              ['active', '🟢 Aktiv'],
              ['suspended', `🔴 Gesperrt (${kpis.suspendedCount})`],
              ['limit_warning', `⚠️ Limit ≥80% (${kpis.limitWarningCount})`],
              ['license_warning', `📅 Lizenz (${kpis.licenseIssuesCount})`],
            ] as [StatusFilter, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`btn btn-sm ${statusFilter === key ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setStatusFilter(key)}
              >
                {label}
              </button>
            ))}

            <select
              className="input"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              style={{ width: 'auto', padding: '6px 10px', fontSize: '0.82rem', height: 34 }}
            >
              <option value="created_desc">Sortierung: Neueste zuerst</option>
              <option value="name_asc">Sortierung: Name (A–Z)</option>
              <option value="employees_desc">Sortierung: Meiste Mitarbeiter</option>
            </select>
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="glass-card" style={{
            padding: '14px 18px',
            marginBottom: '20px',
            background: 'rgba(239, 68, 68, 0.12)',
            borderColor: 'rgba(239, 68, 68, 0.4)',
          }}>
            <p style={{ color: '#ef4444', margin: 0, fontSize: '0.9rem' }}>❌ {error}</p>
          </div>
        )}

        {/* Loading / Empty / List */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton-card" style={{ height: '160px' }} />
            ))}
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="glass-card" style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🏢</div>
            <h3 style={{ color: 'var(--text-primary)', marginBottom: '6px' }}>Keine passenden Mandanten gefunden</h3>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              Passe deine Suchbegriffe oder Filter an oder lege einen neuen Mandanten an.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {filteredTenants.map((t) => {
              const isSystem = t.slug === 'system';
              const expired = isLicenseExpired(t.license_expires_at);
              const expiringSoon = isLicenseExpiringSoon(t.license_expires_at);
              const utilizationPct = t.max_employees
                ? Math.min(100, Math.round((t.active_employees_count / t.max_employees) * 100))
                : null;
              const barColor =
                utilizationPct === null
                  ? '#10b981'
                  : utilizationPct >= 100
                  ? '#ef4444'
                  : utilizationPct >= 80
                  ? '#f59e0b'
                  : '#10b981';

              return (
                <div
                  key={t.id}
                  className="glass-card animate-slide-up"
                  style={{
                    padding: '20px 24px',
                    borderLeft: t.is_suspended
                      ? '4px solid #ef4444'
                      : expired
                      ? '4px solid #f97316'
                      : isSystem
                      ? '4px solid #8b5cf6'
                      : '4px solid #10b981',
                  }}
                >
                  {/* Top Row: Tenant Identity & Action Buttons */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    gap: '16px',
                  }}>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flex: '1 1 420px' }}>
                      <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '12px',
                        background: t.is_suspended ? 'rgba(239,68,68,0.12)' : 'rgba(99,102,241,0.12)',
                        border: '1px solid var(--glass-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.4rem',
                        flexShrink: 0,
                      }}>
                        {t.is_suspended ? '🔒' : isSystem ? '🛡️' : '🏢'}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {t.name}
                          </h3>

                          {/* Status Badges */}
                          {isSystem ? (
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: 'rgba(139, 92, 246, 0.18)',
                              color: '#c4b5fd',
                              border: '1px solid rgba(139, 92, 246, 0.35)',
                            }}>
                              SYSTEM
                            </span>
                          ) : t.is_suspended ? (
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: 'rgba(239, 68, 68, 0.18)',
                              color: '#fca5a5',
                              border: '1px solid rgba(239, 68, 68, 0.35)',
                            }}>
                              🔒 GESPERRT
                            </span>
                          ) : (
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: 'rgba(16, 185, 129, 0.16)',
                              color: '#6ee7b7',
                              border: '1px solid rgba(16, 185, 129, 0.35)',
                            }}>
                              🟢 AKTIV
                            </span>
                          )}

                          {t.license_note && (
                            <span style={{
                              fontSize: '0.74rem',
                              padding: '2px 9px',
                              borderRadius: 999,
                              background: 'rgba(99, 102, 241, 0.14)',
                              color: '#a5b4fc',
                              border: '1px solid rgba(99, 102, 241, 0.3)',
                            }}>
                              🏷️ {t.license_note}
                            </span>
                          )}

                          {t.license_expires_at && (
                            <span style={{
                              fontSize: '0.74rem',
                              fontWeight: 600,
                              padding: '2px 9px',
                              borderRadius: 999,
                              background: expired
                                ? 'rgba(239, 68, 68, 0.2)'
                                : expiringSoon
                                ? 'rgba(245, 158, 11, 0.2)'
                                : 'rgba(148, 163, 184, 0.12)',
                              color: expired ? '#fca5a5' : expiringSoon ? '#fcd34d' : 'var(--text-secondary)',
                              border: `1px solid ${expired ? 'rgba(239,68,68,0.4)' : expiringSoon ? 'rgba(245,158,11,0.4)' : 'var(--glass-border)'}`,
                            }}>
                              📅 {expired ? `Lizenz abgelaufen (${formatDate(t.license_expires_at)})` : `Lizenz bis ${formatDate(t.license_expires_at)}`}
                            </span>
                          )}
                        </div>

                        {t.is_suspended && t.suspension_reason && (
                          <div style={{
                            marginTop: 6,
                            fontSize: '0.8rem',
                            color: '#fca5a5',
                            background: 'rgba(239, 68, 68, 0.1)',
                            padding: '4px 10px',
                            borderRadius: 6,
                            display: 'inline-block',
                          }}>
                            ⚠️ Sperrgrund: {t.suspension_reason}
                          </div>
                        )}

                        <div style={{
                          display: 'flex',
                          gap: '14px',
                          flexWrap: 'wrap',
                          marginTop: '6px',
                          fontSize: '0.8rem',
                          color: 'var(--text-tertiary)',
                        }}>
                          <span>Slug: <strong style={{ color: 'var(--text-secondary)' }}>{t.slug}</strong></span>
                          <span>•</span>
                          <span>Angelegt: <strong style={{ color: 'var(--text-secondary)' }}>{formatDate(t.created_at)}</strong></span>
                          <span>•</span>
                          <span>Schichttypen: <strong style={{ color: 'var(--text-secondary)' }}>{t.shift_types_count}</strong></span>
                          <span>•</span>
                          <span>ID: <code style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{t.id}</code></span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {!isSystem && (
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={impersonatingId === t.id}
                          onClick={() => handleImpersonate(t)}
                          title="Als Administrator direkt in diesen Mandanten einloggen"
                        >
                          {impersonatingId === t.id ? '⏳ Öffne...' : '🚀 Betrieb öffnen (Support-Login)'}
                        </button>
                      )}
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOpenUsersModal(t)}
                      >
                        👥 Benutzer & Admins ({t.users_count})
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOpenEdit(t)}
                      >
                        ✏️ Lizenz & Details
                      </button>
                      {!isSystem && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleQuickToggleSuspend(t)}
                          style={{
                            borderColor: t.is_suspended ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)',
                            color: t.is_suspended ? '#6ee7b7' : '#fcd34d',
                          }}
                        >
                          {t.is_suspended ? '🔓 Freigeben' : '🔒 Sperren'}
                        </button>
                      )}
                      {!isSystem && (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDeleteTenant(t.id, t.name)}
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Bottom Row: Employee Utilization Bar & Master-Accounts List */}
                  <div style={{
                    marginTop: '16px',
                    paddingTop: '14px',
                    borderTop: '1px solid var(--glass-border)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '18px',
                    alignItems: 'center',
                  }}>
                    {/* Employee Limit & Utilization */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 6 }}>
                        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                          👥 Aktive Mitarbeiter im Dienstplan:
                        </span>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          {t.active_employees_count} / {t.max_employees !== null ? t.max_employees : '∞ Unbegrenzt'}
                          {t.total_employees_count > t.active_employees_count && (
                            <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>
                              {' '}({t.total_employees_count} gesamt)
                            </span>
                          )}
                        </span>
                      </div>
                      <div style={{
                        width: '100%',
                        height: 8,
                        borderRadius: 999,
                        background: 'rgba(148, 163, 184, 0.15)',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: utilizationPct !== null ? `${utilizationPct}%` : '25%',
                          height: '100%',
                          background: barColor,
                          borderRadius: 999,
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                    </div>

                    {/* Master-Accounts / Admins Chips */}
                    <div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', marginBottom: 6, fontWeight: 600 }}>
                        🔑 Master-Accounts / Administratoren ({t.admins.length}):
                      </div>
                      {t.admins.length === 0 ? (
                        <span style={{ fontSize: '0.8rem', color: '#f59e0b' }}>
                          ⚠️ Kein aktiver Admin-Account vorhanden!
                        </span>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {t.admins.map((adm) => (
                            <div
                              key={adm.id}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '4px 10px',
                                borderRadius: 8,
                                background: 'rgba(148, 163, 184, 0.08)',
                                border: '1px solid var(--glass-border)',
                                fontSize: '0.78rem',
                              }}
                            >
                              <strong style={{ color: 'var(--text-primary)' }}>
                                {adm.first_name} {adm.last_name}
                              </strong>
                              <span style={{ color: 'var(--text-secondary)' }}>{adm.email}</span>
                              {adm.username && (
                                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>@{adm.username}</span>
                              )}
                              {adm.linked_employee_id && (
                                <span
                                  title={`Verknüpft mit Mitarbeiterprofil: ${adm.linked_employee_name || 'Ja'}`}
                                  style={{
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    background: 'rgba(16, 185, 129, 0.15)',
                                    color: '#6ee7b7',
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                  }}
                                >
                                  👤 Im Dienstplan
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* =====================================================================
          MODAL 1: CREATE TENANT
         ===================================================================== */}
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
          padding: '16px',
        }}>
          <div className="glass-card animate-slide-up" style={{
            width: '100%',
            maxWidth: '620px',
            padding: '28px',
            maxHeight: '92vh',
            overflowY: 'auto',
          }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '18px', color: 'var(--text-primary)' }}>
              ➕ Neuen Mandanten (Betrieb) anlegen
            </h3>

            {actionError && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '16px',
                color: '#ef4444',
                fontSize: '0.85rem',
              }}>
                ❌ {actionError}
              </div>
            )}

            <form onSubmit={handleCreateTenant}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div className="form-group">
                  <label>Betriebsname *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="z.B. Hotel Adler GmbH"
                  />
                </div>
                <div className="form-group">
                  <label>Slug (Kurzkennung) *</label>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="z.B. hotel-adler"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div className="form-group">
                  <label>Mitarbeiterlimit</label>
                  <input
                    type="number"
                    min={1}
                    value={maxEmployees}
                    onChange={(e) => setMaxEmployees(e.target.value !== '' ? Number(e.target.value) : '')}
                    placeholder="Unbegrenzt"
                  />
                </div>
                <div className="form-group">
                  <label>Vertrags-/Lizenznotiz</label>
                  <input
                    type="text"
                    value={licenseNote}
                    onChange={(e) => setLicenseNote(e.target.value)}
                    placeholder="z.B. KD-1042 • Pro"
                  />
                </div>
                <div className="form-group">
                  <label>Lizenz gültig bis</label>
                  <input
                    type="date"
                    value={licenseExpiresAt}
                    onChange={(e) => setLicenseExpiresAt(e.target.value)}
                  />
                </div>
              </div>

              <div style={{
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                marginBottom: '18px',
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  <input
                    type="checkbox"
                    checked={seedDefaultShifts}
                    onChange={(e) => setSeedDefaultShifts(e.target.checked)}
                    style={{ width: 16, height: 16 }}
                  />
                  🔄 Standard-Schichttypen direkt anlegen (Frühschicht 06–14, Spätschicht 14–22, Nachtschicht 22–06)
                </label>
              </div>

              <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '16px', marginBottom: '16px' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>
                  🔑 Betriebsadministrator (Master-Account) einrichten
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
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
                    <label>Eindeutiger Benutzername (Optional)</label>
                    <input
                      type="text"
                      value={managerUsername}
                      onChange={(e) => setManagerUsername(e.target.value)}
                      placeholder={slug ? `z.B. admin.${slug}` : 'Automatisch generieren'}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label>Manager-Passwort *</label>
                  <input
                    type="password"
                    required
                    value={managerPassword}
                    onChange={(e) => setManagerPassword(e.target.value)}
                    placeholder="Mindestens 8 Zeichen"
                  />
                </div>

                <div style={{
                  padding: '12px',
                  borderRadius: '8px',
                  background: 'rgba(99, 102, 241, 0.08)',
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={createManagerEmployee}
                      onChange={(e) => setCreateManagerEmployee(e.target.checked)}
                      style={{ width: 16, height: 16 }}
                    />
                    👤 Master-Account gleichzeitig als Mitarbeiter im Dienstplan anlegen
                  </label>
                  {createManagerEmployee && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '10px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.78rem' }}>Wochenstunden (Soll)</label>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          step={0.5}
                          value={managerWeeklyHours}
                          onChange={(e) => setManagerWeeklyHours(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.78rem' }}>Urlaubstage / Jahr</label>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          value={managerVacationDays}
                          onChange={(e) => setManagerVacationDays(parseInt(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
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

      {/* =====================================================================
          MODAL 2: EDIT TENANT & LICENSE
         ===================================================================== */}
      {isEditOpen && editingTenant && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'var(--glass-blur)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 200,
          padding: '16px',
        }}>
          <div className="glass-card animate-slide-up" style={{
            width: '100%',
            maxWidth: '560px',
            padding: '28px',
            maxHeight: '92vh',
            overflowY: 'auto',
          }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '18px', color: 'var(--text-primary)' }}>
              ✏️ Mandant & Lizenz bearbeiten: {editingTenant.name}
            </h3>

            {actionError && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '16px',
                color: '#ef4444',
                fontSize: '0.85rem',
              }}>
                ❌ {actionError}
              </div>
            )}

            <form onSubmit={handleEditTenant}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div className="form-group">
                  <label>Betriebsname *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Slug *</label>
                  <input
                    type="text"
                    required
                    disabled={editingTenant.slug === 'system'}
                    value={editSlug}
                    onChange={(e) => setEditSlug(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div className="form-group">
                  <label>Mitarbeiterlimit (Aktuell aktiv: {editingTenant.active_employees_count})</label>
                  <input
                    type="number"
                    min={1}
                    value={editMaxEmployees}
                    onChange={(e) => setEditMaxEmployees(e.target.value !== '' ? Number(e.target.value) : '')}
                    placeholder="Leer lassen für unbegrenzt"
                  />
                </div>
                <div className="form-group">
                  <label>Vertrags- / Lizenznotiz</label>
                  <input
                    type="text"
                    value={editLicenseNote}
                    onChange={(e) => setEditLicenseNote(e.target.value)}
                    placeholder="z.B. Vertrag #2026-104 • BLS.ISP"
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '18px' }}>
                <label>Lizenz gültig bis (Optional – nach Ablauf wird der Login blockiert)</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="date"
                    value={editLicenseExpiresAt}
                    onChange={(e) => setEditLicenseExpiresAt(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  {editLicenseExpiresAt && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditLicenseExpiresAt('')}
                    >
                      Unbegrenzt
                    </button>
                  )}
                </div>
              </div>

              {editingTenant.slug !== 'system' && (
                <div style={{
                  padding: '14px',
                  borderRadius: '8px',
                  background: editIsSuspended ? 'rgba(239, 68, 68, 0.12)' : 'rgba(148, 163, 184, 0.06)',
                  border: `1px solid ${editIsSuspended ? 'rgba(239, 68, 68, 0.4)' : 'var(--glass-border)'}`,
                  marginBottom: '18px',
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', color: editIsSuspended ? '#fca5a5' : 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={editIsSuspended}
                      onChange={(e) => setEditIsSuspended(e.target.checked)}
                      style={{ width: 16, height: 16 }}
                    />
                    🔒 Mandant sperren / pausieren (Logins & API-Zugriffe vorübergehend blockieren)
                  </label>
                  {editIsSuspended && (
                    <div className="form-group" style={{ marginTop: '10px', marginBottom: 0 }}>
                      <label style={{ fontSize: '0.8rem' }}>Sperrgrund (wird den Nutzern beim Login angezeigt)</label>
                      <input
                        type="text"
                        value={editSuspensionReason}
                        onChange={(e) => setEditSuspensionReason(e.target.value)}
                        placeholder="z.B. Offene Rechnung / Wartungsarbeiten"
                      />
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsEditOpen(false)} disabled={saving}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Speichere...' : 'Änderungen speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: TENANT USERS & MASTER-ACCOUNTS MANAGEMENT
         ===================================================================== */}
      {usersModalTenant && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.78)',
          backdropFilter: 'var(--glass-blur)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 210,
          padding: '16px',
        }}>
          <div className="glass-card animate-slide-up" style={{
            width: '100%',
            maxWidth: '860px',
            padding: '28px',
            maxHeight: '92vh',
            overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  👥 Benutzer & Master-Accounts: {usersModalTenant.name}
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                  Verwalte alle Login-Accounts dieses Mandanten, setze Passwörter zurück oder verknüpfe Administratoren mit dem Dienstplan.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setEditingUser(null);
                    setShowAddUserForm(!showAddUserForm);
                    setUsersError(null);
                    setUsersSuccess(null);
                  }}
                >
                  {showAddUserForm ? '✕ Formular schließen' : '➕ Neuen Account anlegen'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setUsersModalTenant(null)}
                >
                  Schließen
                </button>
              </div>
            </div>

            {usersError && (
              <div style={{
                padding: '10px 14px',
                marginBottom: 14,
                borderRadius: 8,
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.4)',
                color: '#ef4444',
                fontSize: '0.85rem',
              }}>
                ❌ {usersError}
              </div>
            )}

            {usersSuccess && (
              <div style={{
                padding: '10px 14px',
                marginBottom: 14,
                borderRadius: 8,
                background: 'rgba(16,185,129,0.12)',
                border: '1px solid rgba(16,185,129,0.4)',
                color: '#10b981',
                fontSize: '0.85rem',
              }}>
                ✅ {usersSuccess}
              </div>
            )}

            {/* Add New User Sub-Form */}
            {showAddUserForm && (
              <form
                onSubmit={handleCreateTenantUser}
                style={{
                  padding: '18px',
                  marginBottom: '18px',
                  borderRadius: '10px',
                  background: 'rgba(99, 102, 241, 0.08)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                }}
              >
                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                  ➕ Neuen Benutzer / Administrator für "{usersModalTenant.name}" anlegen
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Vorname *</label>
                    <input
                      type="text"
                      required
                      value={newUserFirstName}
                      onChange={(e) => setNewUserFirstName(e.target.value)}
                      placeholder="Anna"
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Nachname *</label>
                    <input
                      type="text"
                      required
                      value={newUserLastName}
                      onChange={(e) => setNewUserLastName(e.target.value)}
                      placeholder="Beispiel"
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Rolle *</label>
                    <select
                      className="input"
                      value={newUserRole}
                      onChange={(e) => setNewUserRole(e.target.value)}
                    >
                      <option value="admin">🔑 Admin (Master-Account)</option>
                      <option value="planner">📋 Planer (Schichtplaner)</option>
                      <option value="viewer">👤 Mitarbeiter (Viewer)</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>E-Mail *</label>
                    <input
                      type="email"
                      required
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      placeholder="name@firma.de"
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Benutzername (Optional)</label>
                    <input
                      type="text"
                      value={newUserUsername}
                      onChange={(e) => setNewUserUsername(e.target.value)}
                      placeholder="Automatisch generieren"
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Initiales Passwort *</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      placeholder="Mind. 8 Zeichen"
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      <input
                        type="checkbox"
                        checked={newUserCreateEmployee}
                        onChange={(e) => setNewUserCreateEmployee(e.target.checked)}
                      />
                      👤 Gleichzeitig als Mitarbeiter im Dienstplan anlegen
                    </label>
                    {newUserCreateEmployee && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="number"
                          className="input"
                          min={0}
                          max={60}
                          step={0.5}
                          value={newUserWeeklyHours}
                          onChange={(e) => setNewUserWeeklyHours(parseFloat(e.target.value) || 0)}
                          style={{ width: 75, padding: '4px 8px', height: 30, fontSize: '0.8rem' }}
                          title="Wochenstunden (Soll)"
                        />
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Std./Wo.</span>
                        <input
                          type="number"
                          className="input"
                          min={0}
                          max={60}
                          value={newUserVacationDays}
                          onChange={(e) => setNewUserVacationDays(parseInt(e.target.value) || 0)}
                          style={{ width: 70, padding: '4px 8px', height: 30, fontSize: '0.8rem' }}
                          title="Urlaubstage pro Jahr"
                        />
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Urlaubstage</span>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddUserForm(false)}>
                      Abbrechen
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={userSaving}>
                      {userSaving ? 'Speichere...' : 'Account erstellen'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Edit Existing User Sub-Form */}
            {editingUser && (
              <form
                onSubmit={handleSaveEditUser}
                style={{
                  padding: '18px',
                  marginBottom: '18px',
                  borderRadius: '10px',
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                }}
              >
                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                  ✏️ Account bearbeiten: {editingUser.first_name} {editingUser.last_name} ({editingUser.email})
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Vorname</label>
                    <input
                      type="text"
                      required
                      value={editUserFirstName}
                      onChange={(e) => setEditUserFirstName(e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Nachname</label>
                    <input
                      type="text"
                      required
                      value={editUserLastName}
                      onChange={(e) => setEditUserLastName(e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Rolle</label>
                    <select
                      className="input"
                      disabled={editingUser.role === 'super_admin'}
                      value={editUserRole}
                      onChange={(e) => setEditUserRole(e.target.value)}
                    >
                      <option value="admin">🔑 Admin (Master-Account)</option>
                      <option value="planner">📋 Planer</option>
                      <option value="viewer">👤 Mitarbeiter (Viewer)</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>E-Mail-Adresse</label>
                    <input
                      type="email"
                      required
                      value={editUserEmail}
                      onChange={(e) => setEditUserEmail(e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Eindeutiger Benutzername</label>
                    <input
                      type="text"
                      value={editUserUsername}
                      onChange={(e) => setEditUserUsername(e.target.value)}
                      placeholder="z.B. max.adler"
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Neues Passwort setzen (Optional)</label>
                    <input
                      type="password"
                      value={editUserPassword}
                      onChange={(e) => setEditUserPassword(e.target.value)}
                      placeholder="Leer lassen = unverändert"
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={editUserActive}
                      onChange={(e) => setEditUserActive(e.target.checked)}
                    />
                    Account ist aktiv (Login erlaubt)
                  </label>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingUser(null)}>
                      Abbrechen
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={userSaving}>
                      {userSaving ? 'Speichere...' : 'Änderungen speichern'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Users Table / List */}
            {usersLoading ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Lade Benutzerkonten...
              </div>
            ) : tenantUsers.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Keine Benutzerkonten in diesem Mandanten vorhanden.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {tenantUsers.map((u) => (
                  <div
                    key={u.id}
                    style={{
                      padding: '12px 16px',
                      borderRadius: '10px',
                      background: 'rgba(148, 163, 184, 0.06)',
                      border: '1px solid var(--glass-border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                          {u.first_name} {u.last_name}
                        </strong>
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background:
                            u.role === 'admin' || u.role === 'super_admin'
                              ? 'rgba(99, 102, 241, 0.2)'
                              : u.role === 'planner'
                              ? 'rgba(245, 158, 11, 0.2)'
                              : 'rgba(148, 163, 184, 0.15)',
                          color:
                            u.role === 'admin' || u.role === 'super_admin'
                              ? '#a5b4fc'
                              : u.role === 'planner'
                              ? '#fcd34d'
                              : 'var(--text-secondary)',
                        }}>
                          {u.role === 'admin' ? '🔑 ADMIN' : u.role === 'planner' ? '📋 PLANER' : u.role.toUpperCase()}
                        </span>

                        {!u.is_active && (
                          <span style={{
                            fontSize: '0.7rem',
                            padding: '2px 7px',
                            borderRadius: 999,
                            background: 'rgba(239, 68, 68, 0.2)',
                            color: '#fca5a5',
                          }}>
                            DEAKTIVIERT
                          </span>
                        )}

                        {u.linked_employee_id ? (
                          <span style={{
                            fontSize: '0.72rem',
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: 'rgba(16, 185, 129, 0.16)',
                            color: '#6ee7b7',
                          }}>
                            👤 Im Dienstplan ({u.linked_employee_name})
                          </span>
                        ) : (
                          <span style={{
                            fontSize: '0.72rem',
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: 'rgba(148, 163, 184, 0.12)',
                            color: 'var(--text-tertiary)',
                          }}>
                            Kein Mitarbeiterprofil
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span>✉️ {u.email}</span>
                        {u.username && (
                          <span>• 👤 Benutzername: <strong style={{ color: 'var(--accent)' }}>@{u.username}</strong></span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {!u.linked_employee_id && u.role !== 'super_admin' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={userSaving}
                          onClick={() => handleEnsureEmployeeProfile(u)}
                          title="Erstellt oder verknüpft ein Mitarbeiterprofil im Dienstplan für diesen Account"
                        >
                          👤 In Dienstplan aufnehmen
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleStartEditUser(u)}
                      >
                        ✏️ Bearbeiten / Passwort
                      </button>
                      {u.role !== 'super_admin' && (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={userSaving}
                          onClick={() => handleDeleteTenantUser(u)}
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 4: SUPER-ADMIN OWN PASSWORD CHANGE
         ===================================================================== */}
      {pwModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
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
              🔑 Super-Admin Passwort ändern
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
            <form onSubmit={handleChangeOwnPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Aktuelles Passwort</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Neues Passwort (mind. 8 Zeichen)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Neues Passwort bestätigen</label>
                <input
                  type="password"
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
    </div>
  );
}
