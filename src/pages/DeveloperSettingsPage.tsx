import React, { useState, useEffect } from 'react';
import { api } from '../services/apiService';
import { useAuthStore } from '../store/useAuthStore';
import { DeveloperSettingsPayload, User, SaleInvoice, BackupFrequency } from '../types';
import { AuditLogPanel } from '../components/audit/AuditLogPanel';
import { Modal } from '../components/common/Modal';
import { UnifiedInvoice } from '../components/pos/UnifiedInvoice';
import { DEFAULT_DEVELOPER_FOOTER, FOOTER_MAX_LENGTH } from '../../shared/invoice';
import { WEEKDAY_LABELS, describeBackupSchedule } from '../utils/backup';
import { LicensePanel } from '../components/developer/LicensePanel';
import { AdminPermissionsPanel } from '../components/developer/AdminPermissionsPanel';
import { DeveloperProfilePanel } from '../components/developer/DeveloperProfilePanel';
import { NetworkPanel } from '../components/developer/NetworkPanel';
import { BackupModePicker } from '../components/backup/BackupModePicker';
import { CloudBackupCard } from '../components/backup/CloudBackupCard';
import { normalizeBackupMode, usesCloud } from '../../shared/backup';
import {
  ShieldAlert,
  ShieldCheck,
  KeyRound,
  FileText,
  Sliders,
  Database,
  Building,
  Save,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Eye,
  EyeOff,
  Check,
  CalendarClock,
  ListChecks,
  Megaphone,
  Network
} from 'lucide-react';

// Minimal sale used to preview how the developer footer wraps on the narrowest (58mm) roll
const FOOTER_PREVIEW_INVOICE: SaleInvoice = {
  id: 0,
  invoice_no: 'INV-PREVIEW-0001',
  sale_date: new Date().toISOString(),
  customer_name: 'Counter Customer',
  user_name: 'Cashier',
  payment_type: 'Cash',
  status: 'completed',
  total_gross: 640,
  total_item_discount: 0,
  bill_discount_pct: 0,
  bill_discount_amt: 0,
  net_total: 640,
  cash_tendered: 700,
  change_due: 60,
  items: [
    {
      product_id: 1,
      c_code: 'GSK',
      p_code: 'PAN-EXT-500',
      product_name: 'Panadol Extra 500mg Tablets',
      unit_type: 'Box',
      is_loose: 0,
      quantity: 2,
      unit_price: 320,
      unit_cost: 270,
      discount_pct: 0,
      discount_amount: 0,
      gross_amount: 640,
      net_amount: 640
    }
  ]
};

interface DeveloperSettingsPageProps {
  onRefreshSettings?: () => void;
}

export const DeveloperSettingsPage: React.FC<DeveloperSettingsPageProps> = ({ onRefreshSettings }) => {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'license' | 'profile' | 'policies' | 'permissions' | 'store' | 'backups' | 'network' | 'passwords' | 'audit'>('license');

  // Developer settings state
  const [settings, setSettings] = useState<DeveloperSettingsPayload>({
    backup_retention_limit: '30',
    backup_frequency: 'daily',
    backup_scheduled_time: '23:00',
    backup_weekly_day: '0',
    allow_admin_create_cashier: 'true',
    allow_admin_create_admin: 'false',
    allow_admin_edit_store_identity: 'false',
    allow_admin_hide_store_identity: 'false',
    loyalty_feature_allowed: 'false',
    store_name: '',
    store_address: '',
    developer_invoice_footer: DEFAULT_DEVELOPER_FOOTER,
    developer_email: ''
  });
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [onlineBackupAvailable, setOnlineBackupAvailable] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  // Users for password reset
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserForReset, setSelectedUserForReset] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);
  const [resetErrorMsg, setResetErrorMsg] = useState<string | null>(null);

  // Audit Logs state
  // Number of audit rows, shown on the audit tab (the table itself is AuditLogPanel)
  const [totalLogs, setTotalLogs] = useState(0);

  // Fetch developer settings
  const fetchSettings = async () => {
    setLoadingSettings(true);
    try {
      const res = await api.getDeveloperSettings();
      setSettings(prev => ({ ...prev, ...res }));
    } catch (err: any) {
      setSaveErrorMsg(err.message || 'Failed to load developer settings');
    } finally {
      setLoadingSettings(false);
    }
  };

  // Fetch users
  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await api.getUsers();
      setUsers(res);
    } catch (err: any) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Refreshes the audit count on the tab after a change that writes to the log
  const refreshAuditCount = async () => {
    try {
      setTotalLogs((await api.getDeveloperAuditLogs({ page: 1, limit: 1 })).total);
    } catch (err: any) {
      console.error('Failed to load audit logs:', err);
    }
  };


  useEffect(() => {
    if (user?.role === 'developer') {
      fetchSettings();
      fetchUsers();
      refreshAuditCount();
    }
  }, [user]);

  useEffect(() => {
    if (activeTab !== 'backups' || user?.role !== 'developer') return;
    api.getCloudBackupStatus()
      .then(status => setOnlineBackupAvailable(status.available))
      .catch(() => setOnlineBackupAvailable(false));
  }, [activeTab, user]);

  // Handle Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccessMsg(null);
    setSaveErrorMsg(null);
    try {
      const res = await api.updateDeveloperSettings(settings);
      setSaveSuccessMsg(res.message || 'Developer settings updated successfully');
      setTimeout(() => setSaveSuccessMsg(null), 4000);
      refreshAuditCount();
    } catch (err: any) {
      setSaveErrorMsg(err.message || 'Failed to save developer settings');
    }
  };

  // Handle Password Reset
  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForReset) return;
    if (newPassword.trim().length < 6) {
      setResetErrorMsg('Password must be at least 6 characters long');
      return;
    }

    setResettingPassword(true);
    setResetSuccessMsg(null);
    setResetErrorMsg(null);
    try {
      const res = await api.developerResetPassword(selectedUserForReset.id, newPassword.trim());
      setResetSuccessMsg(res.message || `Password reset successfully for ${selectedUserForReset.username}`);
      setNewPassword('');
      setTimeout(() => {
        setSelectedUserForReset(null);
        setResetSuccessMsg(null);
      }, 2000);
      refreshAuditCount();
    } catch (err: any) {
      setResetErrorMsg(err.message || 'Failed to reset password');
    } finally {
      setResettingPassword(false);
    }
  };

  if (!user || user.role !== 'developer') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <div className="w-16 h-16 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8 text-rose-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Developer Access Restricted</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md">
          This system configuration area is cryptographically protected and strictly reserved for authorized System Developers.
        </p>
      </div>
    );
  }

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.full_name.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.role.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
              Developer Console
            </span>
            <span className="text-xs text-slate-400 font-mono">Authenticator secured</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1">
            System & Security Master Control
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage system-level policies, backup retention limits, staff credentials, and view real-time audit logs.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              fetchSettings();
              fetchUsers();
              refreshAuditCount();
            }}
            className="flex items-center space-x-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-xl transition"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Sync Live Data</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex overflow-x-auto space-x-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('license')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'license'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <CalendarClock className="w-4 h-4" />
          <span>License</span>
        </button>

        <button
          onClick={() => setActiveTab('profile')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'profile'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Megaphone className="w-4 h-4" />
          <span>Developer Profile</span>
        </button>

        <button
          onClick={() => setActiveTab('policies')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'policies'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>RBAC Policies</span>
        </button>

        <button
          onClick={() => setActiveTab('permissions')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'permissions'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <ListChecks className="w-4 h-4" />
          <span>Admin Permissions</span>
        </button>

        <button
          onClick={() => setActiveTab('store')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'store'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Building className="w-4 h-4" />
          <span>Protected Store Identity</span>
        </button>

        <button
          onClick={() => setActiveTab('backups')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'backups'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Backup Retention</span>
        </button>

        <button
          onClick={() => setActiveTab('network')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'network'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Network className="w-4 h-4" />
          <span>Network (LAN)</span>
        </button>

        <button
          onClick={() => setActiveTab('passwords')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'passwords'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>Staff Password Reset</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'audit'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Security Audit Trail</span>
          {totalLogs > 0 && (
            <span className="ml-1 px-1.5 py-0.2 bg-purple-500/20 text-purple-300 rounded-full text-2xs">
              {totalLogs}
            </span>
          )}
        </button>
      </div>

      {/* Global Alerts */}
      {saveSuccessMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center space-x-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}
      {saveErrorMsg && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center space-x-2 text-xs font-semibold text-rose-600 dark:text-rose-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{saveErrorMsg}</span>
        </div>
      )}

      {activeTab === 'license' && <LicensePanel onChanged={() => refreshAuditCount()} />}

      {activeTab === 'profile' && <DeveloperProfilePanel onSaved={onRefreshSettings} />}

      {activeTab === 'permissions' && <AdminPermissionsPanel />}

      {activeTab === 'network' && <NetworkPanel />}

      {/* TAB 1: RBAC POLICIES */}
      {activeTab === 'policies' && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6 shadow-xs">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-purple-500" />
                <span>Role Enforcement & Creation Policies</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Configure administrative privileges and account generation rights. These policies are enforced at the database level.
              </p>
            </div>

            <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              {/* Toggle 1: Allow Admin create cashier */}
              <div className="flex items-start justify-between p-4 rounded-xl bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800/80">
                <div className="space-y-1 pr-4">
                  <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                    <span>Allow Administrator to Create Cashier Accounts</span>
                    {settings.allow_admin_create_cashier === 'true' ? (
                      <span className="px-2 py-0.5 rounded-sm text-2xs font-bold bg-emerald-500/10 text-emerald-500">Allowed</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-sm text-2xs font-bold bg-rose-500/10 text-rose-500">Restricted</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    When enabled, store administrators can create, update, and manage cashier user accounts. When disabled, only the Developer can register new cashiers.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.allow_admin_create_cashier === 'true'}
                    onChange={(e) => setSettings(prev => ({ ...prev, allow_admin_create_cashier: e.target.checked ? 'true' : 'false' }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

              {/* Toggle 2: Allow Admin create admin */}
              <div className="flex items-start justify-between p-4 rounded-xl bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800/80">
                <div className="space-y-1 pr-4">
                  <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                    <span>Allow Administrator to Create Administrator Accounts</span>
                    {settings.allow_admin_create_admin === 'true' ? (
                      <span className="px-2 py-0.5 rounded-sm text-2xs font-bold bg-emerald-500/10 text-emerald-500">Allowed</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-sm text-2xs font-bold bg-amber-500/10 text-amber-500">Disabled (Recommended)</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Controls whether an existing administrator can spawn secondary administrator accounts. Keep disabled to prevent unauthorized privilege escalation.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.allow_admin_create_admin === 'true'}
                    onChange={(e) => setSettings(prev => ({ ...prev, allow_admin_create_admin: e.target.checked ? 'true' : 'false' }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

              {/* Toggle 3: Allow Admin edit store identity */}
              <div className="flex items-start justify-between p-4 rounded-xl bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800/80">
                <div className="space-y-1 pr-4">
                  <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                    <span>Allow Administrator to Edit Store Name & Address</span>
                    {settings.allow_admin_edit_store_identity === 'true' ? (
                      <span className="px-2 py-0.5 rounded-sm text-2xs font-bold bg-emerald-500/10 text-emerald-500">Allowed</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-sm text-2xs font-bold bg-purple-500/10 text-purple-400">Developer Locked</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    When disabled, Store Name and Address are protected against changes by store staff to guarantee brand integrity and licensed store identity.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.allow_admin_edit_store_identity === 'true'}
                    onChange={(e) => setSettings(prev => ({ ...prev, allow_admin_edit_store_identity: e.target.checked ? 'true' : 'false' }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

              {/* Toggle 4: Allow Admin to hide store identity on receipts */}
              <div className="flex items-start justify-between p-4 rounded-xl bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800/80">
                <div className="space-y-1 pr-4">
                  <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                    <span>Allow Administrator to Hide Store Name & Address on Receipts</span>
                    {settings.allow_admin_hide_store_identity === 'true' ? (
                      <span className="px-2 py-0.5 rounded-sm text-2xs font-bold bg-emerald-500/10 text-emerald-500">Allowed</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-sm text-2xs font-bold bg-purple-500/10 text-purple-400">Developer Locked</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    When disabled, the Store Name and Address always print on 58 mm and 80 mm receipts, and the visibility switches in Invoice Settings are locked for administrators.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.allow_admin_hide_store_identity === 'true'}
                    onChange={(e) => setSettings(prev => ({ ...prev, allow_admin_hide_store_identity: e.target.checked ? 'true' : 'false' }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

              {/* Toggle 5: Loyalty points (M10) */}
              <div className="flex items-start justify-between p-4 rounded-xl bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800/80">
                <div className="space-y-1 pr-4">
                  <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                    <span>Allow Loyalty Points for This Store</span>
                    {settings.loyalty_feature_allowed === 'true' ? (
                      <span className="px-2 py-0.5 rounded-sm text-2xs font-bold bg-emerald-500/10 text-emerald-500">Allowed</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-sm text-2xs font-bold bg-purple-500/10 text-purple-400">Developer Locked</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    When allowed, the Administrator sees Settings → Loyalty, can switch points on, and builds member plans (points per Rs 100, point value, member discount, expiry). When locked, nothing about loyalty is shown and no points are earned or used; saved points are kept.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.loyalty_feature_allowed === 'true'}
                    onChange={(e) => setSettings(prev => ({ ...prev, loyalty_feature_allowed: e.target.checked ? 'true' : 'false' }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <button
                type="submit"
                disabled={loadingSettings}
                className="flex items-center space-x-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition shadow-md disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>Save RBAC Policies</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* TAB 2: PROTECTED STORE IDENTITY & DEVELOPER FOOTER */}
      {activeTab === 'store' && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6 shadow-xs">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                <Building className="w-5 h-5 text-purple-500" />
                <span>Protected Store Profile & Developer Attribution</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Store identity fields configured here persist on all POS receipts and invoices. Developer footer attribution is mandatory.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Pharmacy / Store Name (Protected)
                </label>
                <input
                  type="text"
                  required
                  value={settings.store_name}
                  onChange={(e) => setSettings(prev => ({ ...prev, store_name: e.target.value }))}
                  className="field-input w-full font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Developer Sign-in Email (fixed in this build)
                </label>
                <input
                  type="email"
                  readOnly
                  value={settings.developer_email || ''}
                  className="field-input w-full font-mono cursor-not-allowed"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Store Street Address (Protected)
                </label>
                <input
                  type="text"
                  required
                  value={settings.store_address}
                  onChange={(e) => setSettings(prev => ({ ...prev, store_address: e.target.value }))}
                  className="field-input w-full"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center space-x-1.5">
                  <Lock className="w-4 h-4 text-purple-500" />
                  <span>Developer Invoice Footer Text (Mandatory Attribution)</span>
                </label>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                  <div>
                    <textarea
                      required
                      rows={4}
                      maxLength={FOOTER_MAX_LENGTH}
                      value={settings.developer_invoice_footer}
                      onChange={(e) => setSettings(prev => ({ ...prev, developer_invoice_footer: e.target.value }))}
                      className="field-textarea w-full font-mono"
                    />
                    <div className="flex justify-between gap-2 mt-1 text-2xs text-slate-400">
                      <span>
                        Prints on every 58 mm and 80 mm receipt and cannot be removed by store administrators. Long lines wrap automatically; each sale keeps the footer it was printed with.
                      </span>
                      <span className={`font-mono whitespace-nowrap ${settings.developer_invoice_footer.length >= FOOTER_MAX_LENGTH ? 'text-amber-500 font-bold' : ''}`}>
                        {settings.developer_invoice_footer.length} / {FOOTER_MAX_LENGTH}
                      </span>
                    </div>
                  </div>

                  {/* Live 58mm wrap preview */}
                  <div className="bg-slate-100 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col items-center max-h-[360px] overflow-y-auto">
                    <span className="text-2xs font-bold text-slate-500 mb-2 self-start">58 mm wrap preview</span>
                    <UnifiedInvoice
                      invoice={FOOTER_PREVIEW_INVOICE}
                      settings={{
                        store_name: settings.store_name,
                        store_address: settings.store_address,
                        developer_invoice_footer: settings.developer_invoice_footer
                      }}
                      templateOverride="compact"
                      paperSizeOverride="58mm"
                      showControls={false}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <button
                type="submit"
                disabled={loadingSettings}
                className="flex items-center space-x-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition shadow-md disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>Save Store Identity & Footer</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* TAB 3: BACKUP RETENTION & SCHEDULING */}
      {activeTab === 'backups' && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6 shadow-xs">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                <Database className="w-5 h-5 text-purple-500" />
                <span>Database Backup Retention & Automation Rules</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Every backup is integrity-checked before it counts. Older verified backups beyond the retention limit are removed only after a new backup succeeds, so the last good backup is never lost.
              </p>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <span className="field-label">Backup Type</span>
                <p className="field-hint">Where backups are kept. Online backups go to the store owner's Google Drive, encrypted so only this app can restore them.</p>
              </div>
              <BackupModePicker
                value={normalizeBackupMode(settings.backup_mode)}
                onChange={mode => setSettings(prev => ({ ...prev, backup_mode: mode }))}
                onlineAvailable={onlineBackupAvailable}
              />
              {usesCloud(normalizeBackupMode(settings.backup_mode)) && <CloudBackupCard />}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Backup Retention Limit (Files to Keep)
                </label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  step="1"
                  required
                  value={settings.backup_retention_limit}
                  onChange={(e) => setSettings(prev => ({ ...prev, backup_retention_limit: e.target.value }))}
                  className="field-input w-full font-mono font-bold"
                />
                <span className="text-2xs text-slate-400 mt-1 block">1–365 scheduled, manual &amp; shift-close backups (Google Drive keeps the same number). Pre-restore safety snapshots are kept separately (newest 3).</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Backup Frequency
                </label>
                <select
                  value={settings.backup_frequency}
                  onChange={(e) => setSettings(prev => ({ ...prev, backup_frequency: e.target.value }))}
                  className="field-select w-full"
                >
                  <option value="off">Off (no automatic backups)</option>
                  <option value="twice_daily">Every 12 hours</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
                <span className="text-2xs text-slate-400 mt-1 block">Shift-close backups also run unless this is Off.</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Weekly Backup Day
                </label>
                <select
                  value={settings.backup_weekly_day || '0'}
                  disabled={settings.backup_frequency !== 'weekly'}
                  onChange={(e) => setSettings(prev => ({ ...prev, backup_weekly_day: e.target.value }))}
                  className="field-select w-full disabled:opacity-50"
                >
                  {WEEKDAY_LABELS.map((label, idx) => (
                    <option key={label} value={String(idx)}>{label}</option>
                  ))}
                </select>
                <span className="text-2xs text-slate-400 mt-1 block">Used only for Weekly backups.</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Backup Time of Day
                </label>
                <input
                  type="time"
                  value={settings.backup_scheduled_time || '23:00'}
                  onChange={(e) => setSettings(prev => ({ ...prev, backup_scheduled_time: e.target.value }))}
                  className="field-input w-full font-mono"
                />
                <span className="text-2xs text-slate-400 mt-1 block">24-hour format. Administrators may adjust only this time.</span>
              </div>
            </div>

            <p className="text-xs text-purple-500 dark:text-purple-300 font-medium">
              {describeBackupSchedule(
                (['off', 'twice_daily', 'daily', 'weekly'].includes(settings.backup_frequency) ? settings.backup_frequency : 'daily') as BackupFrequency,
                settings.backup_scheduled_time || '23:00',
                Number(settings.backup_weekly_day || 0)
              )}. Missed runs (e.g. while the PC was off) are caught up once at the next start.
            </p>

            <div className="pt-4 flex justify-end">
              <button
                type="submit"
                disabled={loadingSettings}
                className="flex items-center space-x-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition shadow-md disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>Save Retention Policy</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* TAB 4: STAFF PASSWORD RESET */}
      {activeTab === 'passwords' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                  <KeyRound className="w-5 h-5 text-purple-500" />
                  <span>Developer Staff Password Reset Hub</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Set a new password for an administrator or cashier who forgot theirs.
                </p>
              </div>

              <div className="w-full sm:w-64 relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Filter staff accounts..."
                  className="field-input w-full pl-9 pr-3"
                />
              </div>
            </div>

            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-2xs">
                    <th className="py-2.5 px-3">Username</th>
                    <th className="py-2.5 px-3">Full Name</th>
                    <th className="py-2.5 px-3">Role</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {loadingUsers ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        Loading staff users...
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        No users found matching query.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map(u => (
                      <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                        <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-white">
                          {u.username}
                        </td>
                        <td className="py-3 px-3 text-slate-700 dark:text-slate-300 font-semibold">
                          {u.full_name}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-2xs font-bold ${
                            u.role === 'developer'
                              ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                              : u.role === 'admin'
                              ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                              : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                          }`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center space-x-1 text-xs font-semibold ${
                            u.status === 'active' ? 'text-emerald-500' : 'text-rose-500'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${u.status === 'active' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                            <span>{u.status}</span>
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => {
                              setSelectedUserForReset(u);
                              setNewPassword('');
                              setResetErrorMsg(null);
                              setResetSuccessMsg(null);
                            }}
                            className="inline-flex items-center space-x-1 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 font-bold rounded-lg transition"
                          >
                            <KeyRound className="w-4 h-4" />
                            <span>Reset Password</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: SECURITY AUDIT TRAIL */}
      {activeTab === 'audit' && <AuditLogPanel load={api.getDeveloperAuditLogs} onTotal={setTotalLogs} />}

      {/* MODAL: RESET PASSWORD */}
      <Modal
        isOpen={!!selectedUserForReset}
        onClose={() => {
          if (!resettingPassword) {
            setSelectedUserForReset(null);
            setResetErrorMsg(null);
            setResetSuccessMsg(null);
          }
        }}
        title={`Reset Password for ${selectedUserForReset?.username}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleResetPasswordSubmit} className="space-y-4 text-xs">
          <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 text-xs">
            You are setting a new password for account: <strong className="font-mono">{selectedUserForReset?.username}</strong> ({selectedUserForReset?.role}). This action will be logged in the security audit trail.
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
              New Password (Minimum 6 characters)
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new strong password..."
                className="field-input w-full font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {resetErrorMsg && (
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-500 text-xs font-semibold flex items-center space-x-1.5">
              <AlertTriangle className="w-4 h-4" />
              <span>{resetErrorMsg}</span>
            </div>
          )}

          {resetSuccessMsg && (
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-500 text-xs font-semibold flex items-center space-x-1.5">
              <Check className="w-4 h-4" />
              <span>{resetSuccessMsg}</span>
            </div>
          )}

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              disabled={resettingPassword}
              onClick={() => setSelectedUserForReset(null)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={resettingPassword}
              className="flex items-center space-x-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition shadow-sm disabled:opacity-50"
            >
              <KeyRound className="w-4 h-4" />
              <span>{resettingPassword ? 'Updating...' : 'Confirm Reset'}</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
export default DeveloperSettingsPage;
