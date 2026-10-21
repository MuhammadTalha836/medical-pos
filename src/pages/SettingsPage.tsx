import React, { useState, useEffect } from 'react';
import { api } from '../services/apiService';
import { SystemSettings, User, Role, RolePermissions, InvoiceTemplateType, SaleInvoice } from '../types';
import { useThemeStore } from '../store/useThemeStore';
import { useAuthStore } from '../store/useAuthStore';
import { Modal } from '../components/common/Modal';
import { UnifiedInvoice } from '../components/pos/UnifiedInvoice';
import {
  Store,
  Receipt,
  Users,
  Shield,
  Save,
  CheckCircle2,
  Plus,
  Sun,
  Moon,
  Monitor,
  Key,
  Edit,
  Trash2,
  CheckSquare,
  Square,
  Lock,
  UserPlus,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Search,
  UserCheck,
  Percent,
  FileText,
  LayoutDashboard,
  Printer,
  Eye,
  Sliders,
  Sparkles,
  Check
} from 'lucide-react';

interface SettingsPageProps {
  settings?: SystemSettings | null;
  onRefreshSettings?: () => void;
}

const MOCK_PREVIEW_INVOICE: SaleInvoice = {
  id: 9999,
  invoice_no: 'INV-2026-0089',
  sale_date: new Date().toISOString(),
  customer_name: 'Muhammad Usman (VIP)',
  customer_phone: '0300-1234567',
  payment_type: 'Cash',
  status: 'completed',
  total_gross: 1450.00,
  total_item_discount: 50.00,
  bill_discount_pct: 5,
  bill_discount_amt: 70.00,
  net_total: 1330.00,
  cash_tendered: 1500.00,
  change_due: 170.00,
  user_name: 'Usman Ali (Cashier)',
  items: [
    {
      id: 1,
      sale_id: 9999,
      product_id: 101,
      c_code: 'GSK',
      product_name: 'Panadol Extra 500mg Tablets',
      p_code: 'PAN-EXT-500',
      quantity: 2,
      unit_type: 'Box',
      unit_price: 320.00,
      unit_cost: 270.00,
      gross_amount: 640.00,
      discount_pct: 0,
      discount_amount: 0,
      net_amount: 640.00,
      is_loose: 0,
      location_rack: 'RACK-A1'
    },
    {
      id: 2,
      sale_id: 9999,
      product_id: 102,
      c_code: 'GSK',
      product_name: 'Augmentin 625mg Tablets',
      p_code: 'AUG-625-TAB',
      quantity: 1,
      unit_type: 'Box',
      unit_price: 580.00,
      unit_cost: 490.00,
      gross_amount: 580.00,
      discount_pct: 5,
      discount_amount: 29.00,
      net_amount: 551.00,
      is_loose: 0,
      location_rack: 'RACK-B4'
    },
    {
      id: 3,
      sale_id: 9999,
      product_id: 103,
      c_code: 'RB',
      product_name: 'Disprin 300mg Soluble',
      p_code: 'DIS-300-SOL',
      quantity: 5,
      unit_type: 'Tablet',
      unit_price: 5.00,
      unit_cost: 3.50,
      gross_amount: 25.00,
      discount_pct: 0,
      discount_amount: 0,
      net_amount: 25.00,
      is_loose: 1,
      location_rack: 'RACK-A2'
    }
  ]
};

const DEFAULT_BLANK_PERMISSIONS: RolePermissions = {
  dashboard: false,
  pos: true,
  sales: true,
  khata: false,
  masters: false,
  purchases: false,
  reports: false,
  utilities: false,
  settings: false,
  shifts: false,
  can_add_product: false,
  can_edit_product: false,
  can_delete_product: false,
  can_add_company: false,
  can_edit_company: false,
  can_delete_company: false,
  can_delete_invoice: false,
  can_return_sale: false,
  can_view_all_sales: false,
  can_view_financial_kpis: false,
  can_add_purchase: false,
  can_add_customer: false,
  can_receive_payment: false,
  can_edit_customer: false,
  can_delete_customer: false,
  can_discount: true,
  can_backup: false,
  can_restore: false,
  can_shift_close: false,
  can_manage_shifts: false,
  can_stock_zero: false,
  can_manage_users: false,
  can_manage_roles: false
};

const DEFAULT_CASHIER_PERMISSIONS: RolePermissions = {
  dashboard: false,
  pos: true,
  sales: true,
  khata: true,
  masters: true,
  purchases: false,
  reports: false,
  utilities: false,
  settings: false,
  shifts: false,
  can_add_product: true,
  can_edit_product: false,
  can_delete_product: false,
  can_add_company: true,
  can_edit_company: false,
  can_delete_company: false,
  can_delete_invoice: false,
  can_return_sale: true,
  can_view_all_sales: true,
  can_view_financial_kpis: false,
  can_add_purchase: false,
  can_add_customer: true,
  can_receive_payment: true,
  can_edit_customer: false,
  can_delete_customer: false,
  can_discount: true,
  can_backup: false,
  can_restore: false,
  can_shift_close: true,
  can_manage_shifts: false,
  can_stock_zero: false,
  can_manage_users: false,
  can_manage_roles: false
};

const DEFAULT_ADMIN_PERMISSIONS: RolePermissions = {
  dashboard: true,
  pos: true,
  sales: true,
  khata: true,
  masters: true,
  purchases: true,
  reports: true,
  utilities: true,
  settings: true,
  shifts: true,
  can_add_product: true,
  can_edit_product: true,
  can_delete_product: true,
  can_add_company: true,
  can_edit_company: true,
  can_delete_company: true,
  can_delete_invoice: true,
  can_return_sale: true,
  can_view_all_sales: true,
  can_view_financial_kpis: true,
  can_add_purchase: true,
  can_add_customer: true,
  can_receive_payment: true,
  can_edit_customer: true,
  can_delete_customer: true,
  can_discount: true,
  can_backup: true,
  can_restore: true,
  can_shift_close: true,
  can_manage_shifts: true,
  can_stock_zero: true,
  can_manage_users: true,
  can_manage_roles: true
};

export const SettingsPage: React.FC<SettingsPageProps> = ({ settings, onRefreshSettings }) => {
  const { theme, setTheme } = useThemeStore();
  const { user: currentUser, updateCurrentUser, hasPermission } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'store' | 'invoice' | 'users' | 'roles'>('store');
  const [previewTemplate, setPreviewTemplate] = useState<InvoiceTemplateType>('thermal');

  const [formData, setFormData] = useState<SystemSettings>({
    store_name: '',
    store_address: '',
    store_phone: '',
    drug_license_no: '',
    tax_no: '',
    receipt_header: '',
    receipt_footer: '',
    receipt_terms: '',
    currency_symbol: 'Rs.',
    auto_backup_dir: './backups',
    auto_backup_enabled: 'true',
    low_stock_threshold: '10',
    paper_width: '80mm',
    max_bill_discount_pct: '14',
    default_invoice_template: 'thermal',
    invoice_paper_size: '80mm',
    return_policy_text: 'Unopened medicines in original packaging may be returned or exchanged within 3 days with this invoice. Heat-sensitive and loose units are non-returnable.',
    show_store_name: 'true',
    show_store_phone: 'true',
    show_store_address: 'true',
    show_store_license: 'true',
    show_invoice_no: 'true',
    show_invoice_date: 'true',
    show_cashier_name: 'true',
    show_customer_name: 'true',
    show_customer_phone: 'true',
    show_col_product_name: 'true',
    show_col_p_code: 'true',
    show_col_unit: 'true',
    show_col_unit_price: 'true',
    show_col_discount: 'true',
    show_col_tax: 'true',
    show_col_total: 'true',
    show_summary_item_count: 'true',
    show_summary_gross: 'true',
    show_summary_discount: 'true',
    show_summary_tax: 'true',
    show_summary_net: 'true',
    show_summary_received: 'true',
    show_summary_change: 'true',
    show_terms: 'true',
    show_footer_note: 'true',
    show_return_policy: 'true',
    show_developer_info: 'true'
  });

  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // User Modals
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState('cashier');

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editRole, setEditRole] = useState('cashier');
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [editPassword, setEditPassword] = useState('');

  // Role Modals
  const [isAddRoleModalOpen, setIsAddRoleModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDisplayName, setNewRoleDisplayName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [newRolePermissions, setNewRolePermissions] = useState<RolePermissions>({ ...DEFAULT_CASHIER_PERMISSIONS });

  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [editRoleDisplayName, setEditRoleDisplayName] = useState('');
  const [editRoleDescription, setEditRoleDescription] = useState('');
  const [editRolePermissions, setEditRolePermissions] = useState<RolePermissions>({ ...DEFAULT_BLANK_PERMISSIONS });

  useEffect(() => {
    if (settings) {
      setFormData(prev => ({ ...prev, ...settings }));
      if (settings.default_invoice_template) {
        setPreviewTemplate(settings.default_invoice_template as InvoiceTemplateType);
      }
    }
    api.getSettings().then(s => {
      setFormData(prev => ({ ...prev, ...s }));
      if (s.default_invoice_template) {
        setPreviewTemplate(s.default_invoice_template as InvoiceTemplateType);
      }
    });
    fetchUsers();
    fetchRoles();
  }, [settings]);

  const handleToggleField = (fieldKey: string) => {
    if (fieldKey === 'show_developer_info') return; // Strictly mandatory
    setFormData(prev => ({
      ...prev,
      [fieldKey]: prev[fieldKey] === 'false' ? 'true' : 'false'
    }));
  };

  const handleSelectAllFields = () => {
    setFormData(prev => ({
      ...prev,
      show_store_name: 'true',
      show_store_phone: 'true',
      show_store_address: 'true',
      show_store_license: 'true',
      show_invoice_no: 'true',
      show_invoice_date: 'true',
      show_cashier_name: 'true',
      show_customer_name: 'true',
      show_customer_phone: 'true',
      show_col_product_name: 'true',
      show_col_p_code: 'true',
      show_col_unit: 'true',
      show_col_unit_price: 'true',
      show_col_discount: 'true',
      show_col_tax: 'true',
      show_col_total: 'true',
      show_summary_item_count: 'true',
      show_summary_gross: 'true',
      show_summary_discount: 'true',
      show_summary_tax: 'true',
      show_summary_net: 'true',
      show_summary_received: 'true',
      show_summary_change: 'true',
      show_terms: 'true',
      show_footer_note: 'true',
      show_return_policy: 'true',
      show_developer_info: 'true'
    }));
  };

  const handleResetInvoiceDefaults = () => {
    setFormData(prev => ({
      ...prev,
      default_invoice_template: 'thermal',
      invoice_paper_size: '80mm',
      return_policy_text: 'Unopened medicines in original packaging may be returned or exchanged within 3 days with this invoice. Heat-sensitive and loose units are non-returnable.',
      show_store_name: 'true',
      show_store_phone: 'true',
      show_store_address: 'true',
      show_store_license: 'true',
      show_invoice_no: 'true',
      show_invoice_date: 'true',
      show_cashier_name: 'true',
      show_customer_name: 'true',
      show_customer_phone: 'true',
      show_col_product_name: 'true',
      show_col_p_code: 'true',
      show_col_unit: 'true',
      show_col_unit_price: 'true',
      show_col_discount: 'true',
      show_col_tax: 'true',
      show_col_total: 'true',
      show_summary_item_count: 'true',
      show_summary_gross: 'true',
      show_summary_discount: 'true',
      show_summary_tax: 'true',
      show_summary_net: 'true',
      show_summary_received: 'true',
      show_summary_change: 'true',
      show_terms: 'true',
      show_footer_note: 'true',
      show_return_policy: 'true',
      show_developer_info: 'true'
    }));
    setPreviewTemplate('thermal');
  };

  const fetchUsers = async () => {
    try {
      const data = await api.getUsers();
      setUsers(data);
    } catch (e) {
      console.error('Failed to fetch users', e);
    }
  };

  const fetchRoles = async () => {
    try {
      const data = await api.getRoles();
      setRoles(data);
    } catch (e) {
      console.error('Failed to fetch roles', e);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      await api.saveSettings(formData);
      setSuccessMsg('Settings updated successfully.');
      onRefreshSettings?.();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      alert('Failed to save settings: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // User Actions
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword || !newFullName.trim()) {
      alert('Please fill in all user fields');
      return;
    }

    try {
      const res = await api.createUser({
        username: newUsername.trim(),
        password: newPassword,
        full_name: newFullName.trim(),
        role: newRole
      });

      if (res.success) {
        setNewUsername('');
        setNewPassword('');
        setNewFullName('');
        setNewRole('cashier');
        setIsAddUserModalOpen(false);
        setSuccessMsg(`User "${newUsername.trim()}" created successfully.`);
        fetchUsers();
        fetchRoles();
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (e: any) {
      alert('Failed to create user: ' + e.message);
    }
  };

  const handleOpenEditUser = (user: User) => {
    setEditingUser(user);
    setEditUsername(user.username);
    setEditFullName(user.full_name);
    setEditRole(user.role);
    setEditStatus(user.status);
    setEditPassword('');
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      const payload: any = {
        username: editUsername.trim(),
        full_name: editFullName.trim(),
        role: editRole,
        status: editStatus
      };
      if (editPassword.trim()) {
        payload.password = editPassword.trim();
      }

      const res = await api.updateUser(editingUser.id, payload);
      if (res.success) {
        if (currentUser && currentUser.id === editingUser.id) {
          updateCurrentUser({
            username: editUsername.trim(),
            full_name: editFullName.trim(),
            role: editRole,
            status: editStatus
          });
        }
        setEditingUser(null);
        setSuccessMsg(`User "${editUsername.trim()}" updated successfully.`);
        fetchUsers();
        fetchRoles();
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (e: any) {
      alert('Failed to update user: ' + e.message);
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (user.id === 1 || user.username === 'admin') {
      alert('Primary Administrator account cannot be deleted.');
      return;
    }

    if (!confirm(`Are you sure you want to delete user "${user.username}" (${user.full_name})? This action cannot be undone.`)) {
      return;
    }

    try {
      const res = await api.deleteUser(user.id);
      if (res.success) {
        setSuccessMsg(`User "${user.username}" deleted successfully.`);
        fetchUsers();
        fetchRoles();
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (e: any) {
      alert('Failed to delete user: ' + e.message);
    }
  };

  // Role Actions
  const handleOpenAddRole = () => {
    setNewRoleName('');
    setNewRoleDisplayName('');
    setNewRoleDescription('');
    setNewRolePermissions({ ...DEFAULT_CASHIER_PERMISSIONS });
    setIsAddRoleModalOpen(true);
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const formattedName = newRoleName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!formattedName || !newRoleDisplayName.trim()) {
      alert('Please enter role identifier and display title');
      return;
    }

    try {
      const res = await api.createRole({
        name: formattedName,
        display_name: newRoleDisplayName.trim(),
        description: newRoleDescription.trim(),
        permissions: newRolePermissions
      });

      if (res.success) {
        setIsAddRoleModalOpen(false);
        setSuccessMsg(`Role "${newRoleDisplayName}" created successfully.`);
        fetchRoles();
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (e: any) {
      alert('Failed to create role: ' + e.message);
    }
  };

  const handleOpenEditRole = (role: Role) => {
    setEditingRole(role);
    setEditRoleDisplayName(role.display_name);
    setEditRoleDescription(role.description || '');
    setEditRolePermissions({ ...DEFAULT_BLANK_PERMISSIONS, ...role.permissions });
  };

  const handleSaveEditRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;

    try {
      // If admin, enforce critical permissions
      const perms = { ...editRolePermissions };
      if (editingRole.name === 'admin') {
        perms.settings = true;
        perms.can_manage_roles = true;
        perms.can_manage_users = true;
      }

      const res = await api.updateRole(editingRole.id, {
        display_name: editRoleDisplayName.trim(),
        description: editRoleDescription.trim(),
        permissions: perms
      });

      if (res.success) {
        setEditingRole(null);
        setSuccessMsg(`Role "${editRoleDisplayName}" updated successfully.`);
        fetchRoles();
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (e: any) {
      alert('Failed to update role: ' + e.message);
    }
  };

  const handleDeleteRole = async (role: Role) => {
    if (role.is_system === 1) {
      alert(`System role "${role.display_name}" is protected and cannot be deleted.`);
      return;
    }

    if ((role.user_count || 0) > 0) {
      alert(`Cannot delete role "${role.display_name}" because ${role.user_count} user(s) are currently assigned to it.`);
      return;
    }

    if (!confirm(`Are you sure you want to permanently delete custom role "${role.display_name}"?`)) {
      return;
    }

    try {
      const res = await api.deleteRole(role.id);
      if (res.success) {
        setSuccessMsg(`Role "${role.display_name}" deleted.`);
        fetchRoles();
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (e: any) {
      alert('Failed to delete role: ' + e.message);
    }
  };

  const togglePermission = (
    currentPerms: RolePermissions,
    setPerms: React.Dispatch<React.SetStateAction<RolePermissions>>,
    key: keyof RolePermissions,
    isRoleAdmin = false
  ) => {
    if (isRoleAdmin && (key === 'settings' || key === 'can_manage_roles' || key === 'can_manage_users')) {
      alert('Administrator role must retain settings and role/user management permissions.');
      return;
    }
    setPerms(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.full_name.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.role.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <div className="page-container">
      {/* Header */}
      <div className="pb-3 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">System Settings & Administration</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Configure pharmacy profile, thermal receipt formatting, staff user accounts, and role permissions
          </p>
        </div>

        {(activeTab === 'store' || activeTab === 'invoice') && (
          <button
            onClick={handleSaveSettings}
            disabled={saving}
            className="btn-save flex items-center space-x-1.5 px-5 py-2 text-xs"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : activeTab === 'invoice' ? 'Save Invoice Settings' : 'Save All Settings'}</span>
          </button>
        )}
      </div>

      {successMsg && (
        <div className="flex items-center space-x-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="flex space-x-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('store')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'store'
              ? 'border-teal-500 text-teal-600 dark:text-teal-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Store className="w-4 h-4" />
          <span>Pharmacy & Store Identity</span>
        </button>

        <button
          onClick={() => setActiveTab('invoice')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'invoice'
              ? 'border-teal-500 text-teal-600 dark:text-teal-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Invoice Settings & Templates</span>
        </button>

        {hasPermission('can_manage_users') && (
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'users'
                ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>User Accounts Management ({users.length})</span>
          </button>
        )}

        {hasPermission('can_manage_roles') && (
          <button
            onClick={() => setActiveTab('roles')}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'roles'
                ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Staff Roles & Permissions ({roles.length})</span>
          </button>
        )}
      </div>

      {/* TAB 1: STORE & RECEIPT SETTINGS */}
      {activeTab === 'store' && (
        <div className="space-y-6">
          {/* Visual Theme & Ergonomics Card */}
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center space-x-2">
              <Monitor className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Counter Ergonomics & Eye-Friendly Theme</h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tailored to minimize eye fatigue during extended 10–12 hour dispensing shifts. Automatically eliminates harsh pure whites and glaring pure blacks.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div
                onClick={() => setTheme('light')}
                className={`cursor-pointer rounded-xl p-4 border transition-all flex items-start space-x-3.5 ${
                  theme === 'light'
                    ? 'bg-teal-50/70 border-teal-500 shadow-sm ring-1 ring-teal-500'
                    : 'bg-slate-50/60 dark:bg-[#0d131f] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className={`p-2 rounded-lg ${theme === 'light' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 dark:bg-[#162032] text-slate-600 dark:text-slate-400'}`}>
                  <Sun className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">Soft Light Mode</span>
                    {theme === 'light' && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700 bg-teal-100 px-2 py-0.5 rounded-full">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Anti-glare warm off-white and cool slate card neutrals. Ideal for bright pharmacy stores and daylight counters.
                  </p>
                </div>
              </div>

              <div
                onClick={() => setTheme('dark')}
                className={`cursor-pointer rounded-xl p-4 border transition-all flex items-start space-x-3.5 ${
                  theme === 'dark'
                    ? 'bg-teal-950/20 border-teal-500 shadow-sm ring-1 ring-teal-500'
                    : 'bg-slate-50/60 dark:bg-[#0d131f] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className={`p-2 rounded-lg ${theme === 'dark' ? 'bg-teal-900/60 text-teal-300' : 'bg-slate-200 dark:bg-[#162032] text-slate-600 dark:text-slate-400'}`}>
                  <Moon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">Medical Dark Mode</span>
                    {theme === 'dark' && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 bg-teal-950/80 border border-teal-800 px-2 py-0.5 rounded-full">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Deep matte charcoal (<code className="text-teal-600 dark:text-teal-400 font-mono">#0A0E17</code>) and soothing teal accents. Calibrated for night shifts and low eye fatigue.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-6">
            {/* Pharmacy Identity */}
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center space-x-2">
                <Store className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Pharmacy Business Identity</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Pharmacy / Store Name</label>
                  <input
                    type="text"
                    required
                    value={formData.store_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, store_name: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-bold focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Drug License Number</label>
                  <input
                    type="text"
                    required
                    value={formData.drug_license_no}
                    onChange={(e) => setFormData(prev => ({ ...prev, drug_license_no: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Store Address</label>
                  <input
                    type="text"
                    value={formData.store_address}
                    onChange={(e) => setFormData(prev => ({ ...prev, store_address: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Phone / Helpline Contact</label>
                  <input
                    type="text"
                    value={formData.store_phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, store_phone: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Tax / NTN Registration Number</label>
                  <input
                    type="text"
                    value={formData.tax_no}
                    onChange={(e) => setFormData(prev => ({ ...prev, tax_no: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Currency Symbol</label>
                  <input
                    type="text"
                    value={formData.currency_symbol}
                    onChange={(e) => setFormData(prev => ({ ...prev, currency_symbol: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono font-bold focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>
            </div>

            {/* Thermal Receipt Layout Settings */}
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center space-x-2">
                <Receipt className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Thermal Receipt Print Layout</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Receipt Sub-Header Tagline</label>
                  <input
                    type="text"
                    value={formData.receipt_header}
                    onChange={(e) => setFormData(prev => ({ ...prev, receipt_header: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Receipt Paper Width</label>
                  <select
                    value={formData.paper_width}
                    onChange={(e) => setFormData(prev => ({ ...prev, paper_width: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  >
                    <option value="80mm">80mm Thermal Paper (Standard POS)</option>
                    <option value="58mm">58mm Thermal Paper (Compact)</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Receipt Terms & Conditions (Printed at Bottom)</label>
                  <textarea
                    rows={3}
                    value={formData.receipt_terms}
                    onChange={(e) => setFormData(prev => ({ ...prev, receipt_terms: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Receipt Footer Note</label>
                  <input
                    type="text"
                    value={formData.receipt_footer}
                    onChange={(e) => setFormData(prev => ({ ...prev, receipt_footer: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>
            </div>

            {/* Automated Backup Settings */}
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center space-x-2">
                <Shield className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Automated Backup Settings</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Enable Auto-Backup on Shift Closing</label>
                  <select
                    value={formData.auto_backup_enabled}
                    onChange={(e) => setFormData(prev => ({ ...prev, auto_backup_enabled: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  >
                    <option value="true">Enabled (Recommended)</option>
                    <option value="false">Disabled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Default Auto Backup Folder</label>
                  <input
                    type="text"
                    value={formData.auto_backup_dir}
                    onChange={(e) => setFormData(prev => ({ ...prev, auto_backup_dir: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>
            </div>

            {/* Counter Sale & POS Discount Policy */}
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center space-x-2">
                <Percent className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Counter Sale & POS Discount Policy</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Maximum Allowed Bill Discount (%)
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      required
                      value={formData.max_bill_discount_pct ?? '14'}
                      onChange={(e) => setFormData(prev => ({ ...prev, max_bill_discount_pct: e.target.value }))}
                      className="w-32 bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono font-bold focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                    />
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">%</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                    Sets the maximum overall bill discount percentage cashiers are permitted to apply at the POS counter. Any value typed above this limit (e.g. typing 15% when limit is 14%) will be automatically blocked and clamped.
                  </p>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* TAB 2: INVOICE SETTINGS & TEMPLATES */}
      {activeTab === 'invoice' && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-teal-900/40 via-slate-900 to-slate-900 border border-teal-800/40 rounded-2xl p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <div className="flex items-center space-x-2">
                  <FileText className="w-5 h-5 text-teal-400" />
                  <h2 className="text-base font-bold text-white tracking-tight">
                    Advanced Invoice Settings & Professional Templates
                  </h2>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Customize printable receipt layout, select default design, control visible columns, and test real-time printer output.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleSelectAllFields}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-teal-300 border border-teal-800/50 text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Enable All Fields</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetInvoiceDefaults}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Defaults</span>
                </button>
              </div>
            </div>
          </div>

          {/* Split-Screen Settings & Live Preview */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Left Column: Controls & Configuration */}
            <form onSubmit={handleSaveSettings} className="xl:col-span-7 space-y-6">
              {/* Card 1: Template Selection */}
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Receipt className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Default Invoice Design Template</h3>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/60 px-2 py-0.5 rounded-full border border-teal-200 dark:border-teal-800/60">
                    Active: {formData.default_invoice_template?.toUpperCase() || 'THERMAL'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  {/* Template 1: Thermal Receipt */}
                  <div
                    onClick={() => {
                      setFormData(prev => ({ ...prev, default_invoice_template: 'thermal' }));
                      setPreviewTemplate('thermal');
                    }}
                    className={`cursor-pointer rounded-xl p-3.5 border transition-all flex flex-col justify-between ${
                      (formData.default_invoice_template || 'thermal') === 'thermal'
                        ? 'bg-teal-50/70 dark:bg-teal-950/20 border-teal-500 shadow-sm ring-1 ring-teal-500'
                        : 'bg-slate-50/60 dark:bg-[#0d131f] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300">
                          <Receipt className="w-4 h-4" />
                        </div>
                        {(formData.default_invoice_template || 'thermal') === 'thermal' && (
                          <span className="p-1 bg-teal-600 text-white rounded-full">
                            <Check className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5">
                        <span className="text-xs font-bold text-slate-900 dark:text-white block">Thermal Receipt</span>
                        <span className="text-[10px] text-teal-600 dark:text-teal-400 font-mono">80mm / 58mm Roll</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        Continuous roll layout optimized for thermal printers with compact typography and simulated barcodes.
                      </p>
                    </div>
                  </div>

                  {/* Template 2: Standard Invoice */}
                  <div
                    onClick={() => {
                      setFormData(prev => ({ ...prev, default_invoice_template: 'standard' }));
                      setPreviewTemplate('standard');
                    }}
                    className={`cursor-pointer rounded-xl p-3.5 border transition-all flex flex-col justify-between ${
                      formData.default_invoice_template === 'standard'
                        ? 'bg-teal-50/70 dark:bg-teal-950/20 border-teal-500 shadow-sm ring-1 ring-teal-500'
                        : 'bg-slate-50/60 dark:bg-[#0d131f] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                          <FileText className="w-4 h-4" />
                        </div>
                        {formData.default_invoice_template === 'standard' && (
                          <span className="p-1 bg-teal-600 text-white rounded-full">
                            <Check className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5">
                        <span className="text-xs font-bold text-slate-900 dark:text-white block">Standard Invoice</span>
                        <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">Sheet A4 / A5</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        Clean document format with structured header, customer profile box, striped table, and signature line.
                      </p>
                    </div>
                  </div>

                  {/* Template 3: Detailed Invoice */}
                  <div
                    onClick={() => {
                      setFormData(prev => ({ ...prev, default_invoice_template: 'detailed' }));
                      setPreviewTemplate('detailed');
                    }}
                    className={`cursor-pointer rounded-xl p-3.5 border transition-all flex flex-col justify-between ${
                      formData.default_invoice_template === 'detailed'
                        ? 'bg-teal-50/70 dark:bg-teal-950/20 border-teal-500 shadow-sm ring-1 ring-teal-500'
                        : 'bg-slate-50/60 dark:bg-[#0d131f] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
                          <LayoutDashboard className="w-4 h-4" />
                        </div>
                        {formData.default_invoice_template === 'detailed' && (
                          <span className="p-1 bg-teal-600 text-white rounded-full">
                            <Check className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5">
                        <span className="text-xs font-bold text-slate-900 dark:text-white block">Detailed Invoice</span>
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">Enterprise A4</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        Comprehensive pharmaceutical enterprise layout with rack locations, SKU codes, and full audit breakdown.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Paper Size Configuration */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Print Paper Size & Layout Format
                  </label>
                  <select
                    value={formData.invoice_paper_size || formData.paper_width || '80mm'}
                    onChange={(e) => {
                      setFormData(prev => ({
                        ...prev,
                        invoice_paper_size: e.target.value as any,
                        paper_width: e.target.value
                      }));
                    }}
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                  >
                    <option value="80mm">80mm Thermal Paper (Standard POS Continuous Roll)</option>
                    <option value="58mm">58mm Thermal Paper (Compact POS Continuous Roll)</option>
                    <option value="A4">A4 Full Sheet Paper (210 × 297 mm Standard Sheet)</option>
                    <option value="A5">A5 Half Sheet Paper (148 × 210 mm Half Sheet)</option>
                  </select>
                </div>
              </div>

              {/* Card 2: Field Visibility Checkboxes */}
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-5 shadow-sm">
                <div className="flex items-center space-x-2">
                  <Sliders className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Printable Field Visibility Controls</h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Enable or disable individual fields on printed receipts. Hiding a field changes its presentation visibility only; all accounting calculations and transaction records remain 100% intact.
                </p>

                {/* Section 1: Store & Invoice Information */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                    1. Store & Invoice Information
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {[
                      { key: 'show_store_name', label: 'Store / Pharmacy Name' },
                      { key: 'show_store_phone', label: 'Store Phone / Helpline' },
                      { key: 'show_store_address', label: 'Store Physical Address' },
                      { key: 'show_store_license', label: 'Drug License & NTN Number' },
                      { key: 'show_invoice_no', label: 'Invoice Number & Barcode' },
                      { key: 'show_invoice_date', label: 'Invoice Date & Time' }
                    ].map(field => {
                      const isChecked = formData[field.key] !== 'false';
                      return (
                        <div
                          key={field.key}
                          onClick={() => handleToggleField(field.key)}
                          className="flex items-center space-x-2.5 p-2 rounded-lg bg-slate-50 dark:bg-[#0d131f] hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors border border-slate-200 dark:border-slate-800/70"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          )}
                          <span className={`text-xs ${isChecked ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-500'}`}>
                            {field.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Section 2: Cashier & Customer Information */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                    2. Cashier & Customer Information
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {[
                      { key: 'show_cashier_name', label: 'Cashier / Dispenser Name' },
                      { key: 'show_customer_name', label: 'Customer Name' },
                      { key: 'show_customer_phone', label: 'Customer Contact Phone' }
                    ].map(field => {
                      const isChecked = formData[field.key] !== 'false';
                      return (
                        <div
                          key={field.key}
                          onClick={() => handleToggleField(field.key)}
                          className="flex items-center space-x-2.5 p-2 rounded-lg bg-slate-50 dark:bg-[#0d131f] hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors border border-slate-200 dark:border-slate-800/70"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          )}
                          <span className={`text-xs ${isChecked ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-500'}`}>
                            {field.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Section 3: Invoice Table Columns */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                    3. Itemized Table Columns
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {[
                      { key: 'show_col_product_name', label: 'Product / Medicine Name' },
                      { key: 'show_col_p_code', label: 'Product Code / Barcode / Loc' },
                      { key: 'show_col_unit', label: 'Quantity & Packaging Unit' },
                      { key: 'show_col_unit_price', label: 'Unit Price / Rate' },
                      { key: 'show_col_discount', label: 'Discount Column' },
                      { key: 'show_col_tax', label: 'Tax Column (If Applicable)' },
                      { key: 'show_col_total', label: 'Line Total Net Amount' }
                    ].map(field => {
                      const isChecked = formData[field.key] !== 'false';
                      return (
                        <div
                          key={field.key}
                          onClick={() => handleToggleField(field.key)}
                          className="flex items-center space-x-2.5 p-2 rounded-lg bg-slate-50 dark:bg-[#0d131f] hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors border border-slate-200 dark:border-slate-800/70"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          )}
                          <span className={`text-xs ${isChecked ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-500'}`}>
                            {field.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Section 4: Financial Summary */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                    4. Financial Totals & Summary
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {[
                      { key: 'show_summary_item_count', label: 'Total Items & Unit Count' },
                      { key: 'show_summary_gross', label: 'Gross Total (Subtotal)' },
                      { key: 'show_summary_discount', label: 'Total Discount Amount' },
                      { key: 'show_summary_tax', label: 'Tax Amount (If Applicable)' },
                      { key: 'show_summary_net', label: 'Net Payable Amount' },
                      { key: 'show_summary_received', label: 'Received / Tendered Cash' },
                      { key: 'show_summary_change', label: 'Change Due / Balance' }
                    ].map(field => {
                      const isChecked = formData[field.key] !== 'false';
                      return (
                        <div
                          key={field.key}
                          onClick={() => handleToggleField(field.key)}
                          className="flex items-center space-x-2.5 p-2 rounded-lg bg-slate-50 dark:bg-[#0d131f] hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors border border-slate-200 dark:border-slate-800/70"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          )}
                          <span className={`text-xs ${isChecked ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-500'}`}>
                            {field.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Section 5: Additional Information & Developer Info */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                    5. Regulatory Policies & Footer
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {[
                      { key: 'show_terms', label: 'Terms & Conditions' },
                      { key: 'show_return_policy', label: 'Return & Exchange Policy' },
                      { key: 'show_footer_note', label: 'Custom Footer Note' }
                    ].map(field => {
                      const isChecked = formData[field.key] !== 'false';
                      return (
                        <div
                          key={field.key}
                          onClick={() => handleToggleField(field.key)}
                          className="flex items-center space-x-2.5 p-2 rounded-lg bg-slate-50 dark:bg-[#0d131f] hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors border border-slate-200 dark:border-slate-800/70"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          )}
                          <span className={`text-xs ${isChecked ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-500'}`}>
                            {field.label}
                          </span>
                        </div>
                      );
                    })}

                    {/* Developer Information (MANDATORY & LOCKED) */}
                    <div className="flex items-center justify-between p-2 rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs opacity-90 cursor-not-allowed">
                      <div className="flex items-center space-x-2.5">
                        <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                        <span className="font-semibold text-slate-900 dark:text-white">Developer Information</span>
                      </div>
                      <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                        <Lock className="w-2.5 h-2.5" />
                        <span>Mandatory</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 3: Return & Exchange Policy Editor */}
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3 shadow-sm">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Return & Exchange Policy Text (Printed on Invoices)
                </label>
                <textarea
                  rows={3}
                  value={formData.return_policy_text || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, return_policy_text: e.target.value }))}
                  placeholder="Enter detailed pharmacy return and exchange instructions..."
                  className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>

              {/* Save Button */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-save px-6 py-2.5 text-xs flex items-center space-x-2"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving Settings...' : 'Save Invoice Configuration'}</span>
                </button>
              </div>
            </form>

            {/* Right Column: Live Interactive Preview */}
            <div className="xl:col-span-5 sticky top-6 space-y-4">
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center space-x-2">
                    <Eye className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      Live Print Preview
                    </span>
                  </div>

                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => setPreviewTemplate('thermal')}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                        previewTemplate === 'thermal'
                          ? 'bg-teal-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Thermal
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewTemplate('standard')}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                        previewTemplate === 'standard'
                          ? 'bg-teal-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Standard
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewTemplate('detailed')}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                        previewTemplate === 'detailed'
                          ? 'bg-teal-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Detailed
                    </button>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Preview updating dynamically with selected fields, paper format, and template styling.
                </div>

                {/* Preview Paper Mount Area */}
                <div className="bg-slate-100 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-center max-h-[750px] overflow-y-auto">
                  <UnifiedInvoice
                    invoice={MOCK_PREVIEW_INVOICE}
                    settings={formData}
                    templateOverride={previewTemplate}
                    showControls={false}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: USER ACCOUNTS MANAGEMENT */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search users by name, username, or role..."
                className="w-full bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>

            <button
              onClick={() => setIsAddUserModalOpen(true)}
              className="btn-save flex items-center space-x-1.5 px-4 py-2 text-white font-bold text-xs rounded-xl shadow-md transition-all"
            >
              <UserPlus className="w-4 h-4" />
              <span>Create New Staff Account</span>
            </button>
          </div>

          {/* Users Table */}
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-[#0d131f] text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">Username / ID</th>
                  <th className="py-3 px-4">Staff Member</th>
                  <th className="py-3 px-4 text-center">Assigned Role</th>
                  <th className="py-3 px-4 text-center">Account Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {filteredUsers.map((u) => {
                  const isCurrent = currentUser?.id === u.id;
                  const isAdminId1 = u.id === 1 || u.username === 'admin';

                  return (
                    <tr key={u.id} className="hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors">
                      <td className="py-3 px-4 font-mono">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-teal-600 dark:text-teal-400">@{u.username}</span>
                          {isCurrent && (
                            <span className="text-[10px] bg-teal-500/10 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300 font-bold px-1.5 py-0.5 rounded border border-teal-500/30">
                              You
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">ID #{u.id}</div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white text-sm">{u.full_name}</div>
                        {u.created_at && (
                          <div className="text-[10px] text-slate-400">Added: {new Date(u.created_at).toLocaleDateString()}</div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          u.role === 'admin'
                            ? 'badge-danger'
                            : u.role === 'pharmacist'
                            ? 'badge-info'
                            : 'badge-success'
                        }`}>
                          {u.role_display || u.role}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          u.status === 'active'
                            ? 'badge-success'
                            : 'bg-slate-100 dark:bg-[#0d131f] text-slate-500 border-slate-300 dark:border-slate-800'
                        }`}>
                          {u.status.toUpperCase()}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center space-x-1.5">
                          <button
                            onClick={() => handleOpenEditUser(u)}
                            className="btn-edit px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1"
                            title="Edit User Login & Reset Password"
                          >
                            <Edit className="w-3.5 h-3.5" />
                            <span>Edit / Reset</span>
                          </button>

                          {!isAdminId1 && (
                            <button
                              onClick={() => handleDeleteUser(u)}
                              className="btn-delete p-1.5 rounded-lg transition-colors"
                              title="Delete Account"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: ROLES & PERMISSIONS MANAGER */}
      {activeTab === 'roles' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Staff Roles & Permission Matrix</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Grant or restrict page views, button actions, product editing, store reports, and system utilities per staff role
              </p>
            </div>

            <button
              onClick={handleOpenAddRole}
              className="btn-save flex items-center space-x-1.5 px-4 py-2 text-white font-bold text-xs rounded-xl shadow-md transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Staff Role</span>
            </button>
          </div>

          {/* Roles Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((r) => {
              const isSys = r.is_system === 1;

              return (
                <div
                  key={r.id}
                  className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        {isSys ? (
                          <Lock className="w-4 h-4 text-amber-500" />
                        ) : (
                          <ShieldCheck className="w-4 h-4 text-teal-500" />
                        )}
                        <h3 className="font-bold text-slate-900 dark:text-white text-base">{r.display_name}</h3>
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        isSys
                          ? 'badge-warning'
                          : 'badge-info'
                      }`}>
                        {isSys ? 'System Role' : 'Custom'}
                      </span>
                    </div>

                    <div className="text-[11px] font-mono text-slate-400">
                      Identifier: <span className="text-teal-600 dark:text-teal-400 font-bold">{r.name}</span>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 min-h-[36px]">
                      {r.description || 'No description provided.'}
                    </p>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>Assigned Users:</span>
                      <span className="font-mono font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-[#0d131f] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800">
                        {r.user_count || 0}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center space-x-2">
                    <button
                      onClick={() => handleOpenEditRole(r)}
                      className="btn-edit flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-colors flex items-center justify-center space-x-1.5"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      <span>Configure Permissions</span>
                    </button>

                    {!isSys && (
                      <button
                        onClick={() => handleDeleteRole(r)}
                        disabled={(r.user_count || 0) > 0}
                        title={(r.user_count || 0) > 0 ? 'Cannot delete role with assigned users' : 'Delete Role'}
                        className="btn-delete p-2 rounded-xl transition-colors disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL: ADD USER */}
      <Modal
        isOpen={isAddUserModalOpen}
        onClose={() => setIsAddUserModalOpen(false)}
        title="Create New Staff Member Account"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Username (Login ID)</label>
            <input
              type="text"
              required
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="e.g. cashier2"
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Full Name</label>
            <input
              type="text"
              required
              value={newFullName}
              onChange={(e) => setNewFullName(e.target.value)}
              placeholder="e.g. Muhammad Ali"
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Initial Password</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Assigned Role</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              {roles.map(r => (
                <option key={r.id} value={r.name}>
                  {r.display_name} ({r.name})
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsAddUserModalOpen(false)}
              className="btn-cancel px-4 py-2 rounded-xl font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-save px-5 py-2 text-white font-bold rounded-xl shadow-md transition-all"
            >
              Create Account
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: EDIT USER & RESET PASSWORD */}
      <Modal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        title={`Edit Staff Account: @${editingUser?.username}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleSaveEditUser} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Username (Login ID)</label>
            <input
              type="text"
              required
              value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Full Name</label>
            <input
              type="text"
              required
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Assigned Role</label>
            <select
              value={editRole}
              onChange={(e) => setEditRole(e.target.value)}
              disabled={editingUser?.id === 1}
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
            >
              {roles.map(r => (
                <option key={r.id} value={r.name}>
                  {r.display_name} ({r.name})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Account Status</label>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as any)}
              disabled={editingUser?.id === 1}
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
            >
              <option value="active">Active (Access Allowed)</option>
              <option value="inactive">Inactive (Access Suspended)</option>
            </select>
          </div>

          <div className="p-3 bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/30 dark:border-amber-800/60 rounded-xl space-y-1.5">
            <div className="flex items-center space-x-1.5 text-amber-700 dark:text-amber-300 font-bold">
              <Key className="w-3.5 h-3.5" />
              <span>Reset Password (Optional)</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Leave this blank if you do not wish to change this staff member's password.
            </p>
            <input
              type="password"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
              placeholder="Enter new password to overwrite"
              className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setEditingUser(null)}
              className="btn-cancel px-4 py-2 rounded-xl font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-save px-5 py-2 text-white font-bold rounded-xl shadow-md transition-all"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: CREATE CUSTOM ROLE */}
      <Modal
        isOpen={isAddRoleModalOpen}
        onClose={() => setIsAddRoleModalOpen(false)}
        title="Create Custom Staff Role"
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleCreateRole} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                Role System Key (Lowercase, unique)
              </label>
              <input
                type="text"
                required
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="e.g. junior_cashier or stock_manager"
                className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                Display Title
              </label>
              <input
                type="text"
                required
                value={newRoleDisplayName}
                onChange={(e) => setNewRoleDisplayName(e.target.value)}
                placeholder="e.g. Junior Cashier"
                className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-bold focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                Role Description
              </label>
              <input
                type="text"
                value={newRoleDescription}
                onChange={(e) => setNewRoleDescription(e.target.value)}
                placeholder="Brief summary of duties and responsibilities"
                className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
            <span className="font-bold text-slate-900 dark:text-white text-sm">Configure Permission Matrix</span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setNewRolePermissions({ ...DEFAULT_ADMIN_PERMISSIONS })}
                className="px-2.5 py-1 text-[11px] rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => setNewRolePermissions({ ...DEFAULT_CASHIER_PERMISSIONS })}
                className="px-2.5 py-1 text-[11px] rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-700 dark:text-teal-300 border border-teal-500/30"
              >
                Cashier Preset
              </button>
              <button
                type="button"
                onClick={() => setNewRolePermissions({ ...DEFAULT_BLANK_PERMISSIONS })}
                className="px-2.5 py-1 text-[11px] rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Matrix Sections */}
          <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
            {/* Section 1: Page Navigation */}
            <div className="p-3 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider text-[11px] block">
                1. Navigation & Module Access (Visible in Sidebar)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { key: 'pos', label: 'Counter Sales (POS)' },
                  { key: 'dashboard', label: 'Dashboard Overview' },
                  { key: 'sales', label: 'Sales History & Invoices' },
                  { key: 'shifts', label: 'Admin Shift Management' },
                  { key: 'khata', label: 'Customer Credit Khata' },
                  { key: 'masters', label: 'Medicine & Company Masters' },
                  { key: 'purchases', label: 'Purchases & Stock Inward' },
                  { key: 'reports', label: 'Reports & Analytics' },
                  { key: 'utilities', label: 'System Utilities & Backup' },
                  { key: 'settings', label: 'System Settings' }
                ].map((item) => (
                  <label
                    key={item.key}
                    onClick={() => togglePermission(newRolePermissions, setNewRolePermissions, item.key as any)}
                    className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors"
                  >
                    {newRolePermissions[item.key as keyof RolePermissions] ? (
                      <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Section 2: Medicine & Company Masters Actions */}
            <div className="p-3 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider text-[11px] block">
                2. Medicines & Distributors Management
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { key: 'can_add_product', label: 'Add New Medicine' },
                  { key: 'can_edit_product', label: 'Edit Medicine Details' },
                  { key: 'can_delete_product', label: 'Delete Medicine' },
                  { key: 'can_add_company', label: 'Add Company / Supplier' },
                  { key: 'can_edit_company', label: 'Edit Company' },
                  { key: 'can_delete_company', label: 'Delete Company' }
                ].map((item) => (
                  <label
                    key={item.key}
                    onClick={() => togglePermission(newRolePermissions, setNewRolePermissions, item.key as any)}
                    className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors"
                  >
                    {newRolePermissions[item.key as keyof RolePermissions] ? (
                      <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Section 3: POS & Counter Sales Actions */}
            <div className="p-3 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider text-[11px] block">
                3. POS Counter & Invoicing Actions
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { key: 'can_discount', label: 'Give Discounts' },
                  { key: 'can_return_sale', label: 'Process Sale Returns' },
                  { key: 'can_delete_invoice', label: 'Delete Invoices' },
                  { key: 'can_view_all_sales', label: 'View All Staff Invoices' }
                ].map((item) => (
                  <label
                    key={item.key}
                    onClick={() => togglePermission(newRolePermissions, setNewRolePermissions, item.key as any)}
                    className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors"
                  >
                    {newRolePermissions[item.key as keyof RolePermissions] ? (
                      <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Section 4: Purchases & Khata Actions */}
            <div className="p-3 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider text-[11px] block">
                4. Supplier Purchases & Customer Khata Actions
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { key: 'can_add_purchase', label: 'Record Supplier Purchases' },
                  { key: 'can_add_customer', label: 'Register Khata Account' },
                  { key: 'can_edit_customer', label: 'Edit Customer & Limits' },
                  { key: 'can_delete_customer', label: 'Delete Khata Account' },
                  { key: 'can_receive_payment', label: 'Receive Cash Recoveries' }
                ].map((item) => (
                  <label
                    key={item.key}
                    onClick={() => togglePermission(newRolePermissions, setNewRolePermissions, item.key as any)}
                    className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors"
                  >
                    {newRolePermissions[item.key as keyof RolePermissions] ? (
                      <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Section 5: Financial Intelligence & Security */}
            <div className="p-3 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider text-[11px] block">
                5. Financial KPIs, Utilities & Security
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { key: 'can_view_financial_kpis', label: 'View Revenue & Financial KPIs' },
                  { key: 'can_backup', label: 'Run Local SQLite Backup' },
                  { key: 'can_restore', label: 'Restore Database Snapshot' },
                  { key: 'can_shift_close', label: 'Execute Shift Closing' },
                  { key: 'can_manage_shifts', label: 'Manage & Reopen Shifts' },
                  { key: 'can_stock_zero', label: 'Reset Stock Zero Audit' },
                  { key: 'can_manage_users', label: 'Manage Staff Logins' },
                  { key: 'can_manage_roles', label: 'Manage Roles & Matrix' }
                ].map((item) => (
                  <label
                    key={item.key}
                    onClick={() => togglePermission(newRolePermissions, setNewRolePermissions, item.key as any)}
                    className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors"
                  >
                    {newRolePermissions[item.key as keyof RolePermissions] ? (
                      <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsAddRoleModalOpen(false)}
              className="btn-cancel px-4 py-2 rounded-xl font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-save px-5 py-2 text-white font-bold rounded-xl shadow-md transition-all"
            >
              Save Custom Role
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: EDIT ROLE & PERMISSIONS MATRIX */}
      <Modal
        isOpen={!!editingRole}
        onClose={() => setEditingRole(null)}
        title={`Configure Role Permissions: ${editingRole?.display_name}`}
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleSaveEditRole} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                Display Title
              </label>
              <input
                type="text"
                required
                value={editRoleDisplayName}
                onChange={(e) => setEditRoleDisplayName(e.target.value)}
                className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-bold focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                System Identifier
              </label>
              <input
                type="text"
                disabled
                value={editingRole?.name || ''}
                className="w-full bg-slate-100 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-500 font-mono"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                Role Description
              </label>
              <input
                type="text"
                value={editRoleDescription}
                onChange={(e) => setEditRoleDescription(e.target.value)}
                placeholder="Brief summary of duties and responsibilities"
                className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
            <span className="font-bold text-slate-900 dark:text-white text-sm">Interactive Permission Checkboxes</span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setEditRolePermissions({ ...DEFAULT_ADMIN_PERMISSIONS })}
                className="px-2.5 py-1 text-[11px] rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => setEditRolePermissions({ ...DEFAULT_CASHIER_PERMISSIONS })}
                className="px-2.5 py-1 text-[11px] rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-700 dark:text-teal-300 border border-teal-500/30"
              >
                Cashier Preset
              </button>
              {editingRole?.name !== 'admin' && (
                <button
                  type="button"
                  onClick={() => setEditRolePermissions({ ...DEFAULT_BLANK_PERMISSIONS })}
                  className="px-2.5 py-1 text-[11px] rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {/* Matrix Sections */}
          <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
            {/* Section 1: Page Navigation */}
            <div className="p-3 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider text-[11px] block">
                1. Navigation & Module Access (Visible in Sidebar)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { key: 'pos', label: 'Counter Sales (POS)' },
                  { key: 'dashboard', label: 'Dashboard Overview' },
                  { key: 'sales', label: 'Sales History & Invoices' },
                  { key: 'shifts', label: 'Admin Shift Management' },
                  { key: 'khata', label: 'Customer Credit Khata' },
                  { key: 'masters', label: 'Medicine & Company Masters' },
                  { key: 'purchases', label: 'Purchases & Stock Inward' },
                  { key: 'reports', label: 'Reports & Analytics' },
                  { key: 'utilities', label: 'System Utilities & Backup' },
                  { key: 'settings', label: 'System Settings' }
                ].map((item) => (
                  <label
                    key={item.key}
                    onClick={() => togglePermission(editRolePermissions, setEditRolePermissions, item.key as any, editingRole?.name === 'admin')}
                    className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors"
                  >
                    {editRolePermissions[item.key as keyof RolePermissions] ? (
                      <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Section 2: Medicine & Company Masters Actions */}
            <div className="p-3 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider text-[11px] block">
                2. Medicines & Distributors Management
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { key: 'can_add_product', label: 'Add New Medicine' },
                  { key: 'can_edit_product', label: 'Edit Medicine Details' },
                  { key: 'can_delete_product', label: 'Delete Medicine' },
                  { key: 'can_add_company', label: 'Add Company / Supplier' },
                  { key: 'can_edit_company', label: 'Edit Company' },
                  { key: 'can_delete_company', label: 'Delete Company' }
                ].map((item) => (
                  <label
                    key={item.key}
                    onClick={() => togglePermission(editRolePermissions, setEditRolePermissions, item.key as any, editingRole?.name === 'admin')}
                    className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors"
                  >
                    {editRolePermissions[item.key as keyof RolePermissions] ? (
                      <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Section 3: POS & Counter Sales Actions */}
            <div className="p-3 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider text-[11px] block">
                3. POS Counter & Invoicing Actions
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { key: 'can_discount', label: 'Give Discounts' },
                  { key: 'can_return_sale', label: 'Process Sale Returns' },
                  { key: 'can_delete_invoice', label: 'Delete Invoices' },
                  { key: 'can_view_all_sales', label: 'View All Staff Invoices' }
                ].map((item) => (
                  <label
                    key={item.key}
                    onClick={() => togglePermission(editRolePermissions, setEditRolePermissions, item.key as any, editingRole?.name === 'admin')}
                    className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors"
                  >
                    {editRolePermissions[item.key as keyof RolePermissions] ? (
                      <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Section 4: Purchases & Khata Actions */}
            <div className="p-3 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider text-[11px] block">
                4. Supplier Purchases & Customer Khata Actions
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { key: 'can_add_purchase', label: 'Record Supplier Purchases' },
                  { key: 'can_add_customer', label: 'Register Khata Account' },
                  { key: 'can_edit_customer', label: 'Edit Customer & Limits' },
                  { key: 'can_delete_customer', label: 'Delete Khata Account' },
                  { key: 'can_receive_payment', label: 'Receive Cash Recoveries' }
                ].map((item) => (
                  <label
                    key={item.key}
                    onClick={() => togglePermission(editRolePermissions, setEditRolePermissions, item.key as any, editingRole?.name === 'admin')}
                    className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors"
                  >
                    {editRolePermissions[item.key as keyof RolePermissions] ? (
                      <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Section 5: Financial Intelligence & Security */}
            <div className="p-3 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider text-[11px] block">
                5. Financial KPIs, Utilities & Security
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { key: 'can_view_financial_kpis', label: 'View Revenue & Financial KPIs' },
                  { key: 'can_backup', label: 'Run Local SQLite Backup' },
                  { key: 'can_restore', label: 'Restore Database Snapshot' },
                  { key: 'can_shift_close', label: 'Execute Shift Closing' },
                  { key: 'can_manage_shifts', label: 'Manage & Reopen Shifts' },
                  { key: 'can_stock_zero', label: 'Reset Stock Zero Audit' },
                  { key: 'can_manage_users', label: 'Manage Staff Logins' },
                  { key: 'can_manage_roles', label: 'Manage Roles & Matrix' }
                ].map((item) => (
                  <label
                    key={item.key}
                    onClick={() => togglePermission(editRolePermissions, setEditRolePermissions, item.key as any, editingRole?.name === 'admin')}
                    className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors"
                  >
                    {editRolePermissions[item.key as keyof RolePermissions] ? (
                      <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setEditingRole(null)}
              className="btn-cancel px-4 py-2 rounded-xl font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-save px-5 py-2 text-white font-bold rounded-xl shadow-md transition-all"
            >
              Save Permissions
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
