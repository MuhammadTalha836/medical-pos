import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/apiService';
import { SystemSettings, User, Role, InvoiceTemplateType, InvoicePaperSize, SaleInvoice } from '../types';
import { composeWhatsAppCredit } from '../../shared/developerProfile';
import { DEFAULT_DEVELOPER_FOOTER, INVOICE_PAPER_SIZES, TEMPLATE_LABELS, normalizePaperSize, normalizeTemplate } from '../../shared/invoice';
import { useThemeStore } from '../store/useThemeStore';
import { useAuthStore } from '../store/useAuthStore';
import { ALL_INVOICE_FIELDS_VISIBLE, DEFAULT_INVOICE_SETTINGS, DEFAULT_SETTINGS } from '../../shared/settingsDefaults';
import { UsersTab } from '../components/settings/UsersTab';
import { RolesTab } from '../components/settings/RolesTab';
import { UnifiedInvoice } from '../components/pos/UnifiedInvoice';
import { ReceiptPrinterCard } from '../components/settings/ReceiptPrinterCard';
import { LoyaltySettingsTab } from '../components/loyalty/LoyaltySettingsTab';
import { moneyFormatter } from '../utils/format';
import {
  DEFAULT_WHATSAPP_RECEIPT_TEMPLATE,
  DEFAULT_WHATSAPP_REMINDER_TEMPLATE,
  RECEIPT_PLACEHOLDERS,
  REMINDER_PLACEHOLDERS,
  WHATSAPP_TEMPLATE_MAX
} from '../../shared/whatsapp';
import {
  Award,
  Store,
  Receipt,
  Users,
  Shield,
  Save,
  CheckCircle2,
  Sun,
  Moon,
  Monitor,
  CheckSquare,
  Square,
  Lock,
  ShieldCheck,
  RotateCcw,
  Percent,
  MessageCircle,
  FileText,
  LayoutDashboard,
  Eye,
  Sliders,
  Sparkles,
  Check
} from 'lucide-react';

const TEMPLATE_CARDS: { id: InvoiceTemplateType; title: string; description: string; icon: React.ElementType }[] = [
  {
    id: 'classic',
    title: 'Classic Receipt',
    description: 'Full column table on 80 mm (two-line rows on 58 mm) with barcode, terms and footer note.',
    icon: Receipt
  },
  {
    id: 'compact',
    title: 'Compact Receipt',
    description: 'Paper-saving two-line item rows with only net, tendered and change totals.',
    icon: FileText
  },
  {
    id: 'detailed',
    title: 'Detailed Receipt',
    description: 'Numbered lines with code & rack, split line/bill discounts, terms and return policy.',
    icon: LayoutDashboard
  }
];

// Store name & address visibility toggles are protected by the Developer
const PROTECTED_IDENTITY_FIELDS = ['show_store_name', 'show_store_address'];

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

export const SettingsPage: React.FC<SettingsPageProps> = ({ settings, onRefreshSettings }) => {
  const { theme, setTheme } = useThemeStore();
  const { user, hasPermission } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'store' | 'invoice' | 'users' | 'roles' | 'loyalty'>('store');
  const showLoyalty = settings?.loyalty_feature_allowed === 'true' && hasPermission('can_manage_loyalty');
  const [previewTemplate, setPreviewTemplate] = useState<InvoiceTemplateType>('classic');
  const [previewPaperSize, setPreviewPaperSize] = useState<InvoicePaperSize>('80mm');
  const previewMountRef = useRef<HTMLDivElement>(null);
  const canHideStoreIdentity = user?.role === 'developer' || settings?.allow_admin_hide_store_identity === 'true';

  // Replaced by the saved settings as soon as they load
  const [formData, setFormData] = useState<SystemSettings>({ ...DEFAULT_SETTINGS } as SystemSettings);


  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setFormData(prev => ({ ...prev, ...settings }));
      setPreviewTemplate(normalizeTemplate(settings.default_invoice_template));
      setPreviewPaperSize(normalizePaperSize(settings.invoice_paper_size));
    }
    api.getSettings().then(s => {
      setFormData(prev => ({ ...prev, ...s }));
      setPreviewTemplate(normalizeTemplate(s.default_invoice_template));
      setPreviewPaperSize(normalizePaperSize(s.invoice_paper_size));
    });
    fetchUsers();
    fetchRoles();
  }, [settings]);

  const handleToggleField = (fieldKey: string) => {
    if (fieldKey === 'show_developer_info') return; // Strictly mandatory
    if (PROTECTED_IDENTITY_FIELDS.includes(fieldKey) && !canHideStoreIdentity) return; // Developer-protected
    setFormData(prev => ({
      ...prev,
      [fieldKey]: prev[fieldKey] === 'false' ? 'true' : 'false'
    }));
  };

  const handleSelectAllFields = () => {
    setFormData(prev => ({ ...prev, ...ALL_INVOICE_FIELDS_VISIBLE }));
  };

  const handleResetInvoiceDefaults = () => {
    setFormData(prev => ({ ...prev, ...DEFAULT_INVOICE_SETTINGS }));
    setPreviewTemplate('classic');
    setPreviewPaperSize('80mm');
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

  const notify = (message: string) => {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const refreshUsersAndRoles = () => {
    fetchUsers();
    fetchRoles();
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      // The loyalty switch is saved by its own tab; an older copy here must not undo it
      const { loyalty_enabled: _enabled, loyalty_feature_allowed: _allowed, ...rest } = formData as SystemSettings;
      void _enabled; void _allowed;
      await api.saveSettings(rest);
      setSuccessMsg('Settings updated successfully.');
      onRefreshSettings?.();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      alert('Failed to save settings: ' + err.message);
    } finally {
      setSaving(false);
    }
  };


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
            className="btn-primary"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : activeTab === 'invoice' ? 'Save Invoice Settings' : 'Save All Settings'}</span>
          </button>
        )}
      </div>

      {successMsg && (
        <div className="flex items-center space-x-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
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

        {showLoyalty && (
          <button
            onClick={() => setActiveTab('loyalty')}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'loyalty'
                ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Award className="w-4 h-4" />
            <span>Loyalty Points</span>
          </button>
        )}
      </div>

      {/* TAB 1: STORE & RECEIPT SETTINGS */}
      {activeTab === 'store' && (
        <div className="space-y-6">
          {/* Visual Theme & Ergonomics Card */}
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs">
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
                    ? 'bg-teal-50/70 border-teal-500 shadow-xs ring-1 ring-teal-500'
                    : 'bg-slate-50/60 dark:bg-surface-inset-dark border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className={`p-2 rounded-lg ${theme === 'light' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 dark:bg-[#162032] text-slate-600 dark:text-slate-400'}`}>
                  <Sun className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">Soft Light Mode</span>
                    {theme === 'light' && (
                      <span className="text-2xs font-bold text-teal-700 bg-teal-100 px-2 py-0.5 rounded-full">
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
                    ? 'bg-teal-950/20 border-teal-500 shadow-xs ring-1 ring-teal-500'
                    : 'bg-slate-50/60 dark:bg-surface-inset-dark border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className={`p-2 rounded-lg ${theme === 'dark' ? 'bg-teal-900/60 text-teal-300' : 'bg-slate-200 dark:bg-[#162032] text-slate-600 dark:text-slate-400'}`}>
                  <Moon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">Medical Dark Mode</span>
                    {theme === 'dark' && (
                      <span className="text-2xs font-bold text-teal-400 bg-teal-950/80 border border-teal-800 px-2 py-0.5 rounded-full">
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
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs">
              <div className="flex items-center space-x-2">
                <Store className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Pharmacy Business Identity</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                    <span>Pharmacy / Store Name</span>
                    {user?.role !== 'developer' && settings?.allow_admin_edit_store_identity !== 'true' && (
                      <span className="text-2xs text-amber-500 font-mono flex items-center">
                        <Lock className="w-4 h-4 mr-0.5 inline" /> Protected
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    required
                    disabled={user?.role !== 'developer' && settings?.allow_admin_edit_store_identity !== 'true'}
                    value={formData.store_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, store_name: e.target.value }))}
                    className={`field-input w-full font-bold ${
                      user?.role !== 'developer' && settings?.allow_admin_edit_store_identity !== 'true' ? 'opacity-60 cursor-not-allowed' : ''
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Drug License Number</label>
                  <input
                    type="text"
                    required
                    value={formData.drug_license_no}
                    onChange={(e) => setFormData(prev => ({ ...prev, drug_license_no: e.target.value }))}
                    className="field-input w-full font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                    <span>Store Address</span>
                    {user?.role !== 'developer' && settings?.allow_admin_edit_store_identity !== 'true' && (
                      <span className="text-2xs text-amber-500 font-mono flex items-center">
                        <Lock className="w-4 h-4 mr-0.5 inline" /> Protected
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    disabled={user?.role !== 'developer' && settings?.allow_admin_edit_store_identity !== 'true'}
                    value={formData.store_address}
                    onChange={(e) => setFormData(prev => ({ ...prev, store_address: e.target.value }))}
                    className={`field-input w-full ${
                      user?.role !== 'developer' && settings?.allow_admin_edit_store_identity !== 'true' ? 'opacity-60 cursor-not-allowed' : ''
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Phone / Helpline Contact</label>
                  <input
                    type="text"
                    value={formData.store_phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, store_phone: e.target.value }))}
                    className="field-input w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Tax / NTN Registration Number</label>
                  <input
                    type="text"
                    value={formData.tax_no}
                    onChange={(e) => setFormData(prev => ({ ...prev, tax_no: e.target.value }))}
                    className="field-input w-full font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Currency Symbol</label>
                  <input
                    type="text"
                    value={formData.currency_symbol}
                    onChange={(e) => setFormData(prev => ({ ...prev, currency_symbol: e.target.value }))}
                    className="field-input w-full font-mono font-bold"
                  />
                </div>
              </div>
            </div>

            {/* Thermal Receipt Layout Settings */}
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs">
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
                    className="field-input w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Receipt Paper Width</label>
                  <div className="w-full bg-slate-50 dark:bg-surface-inset-dark border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                    {normalizePaperSize(formData.invoice_paper_size).replace('mm', ' mm')} thermal roll · change it under Invoice Settings & Templates
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Receipt Terms & Conditions (Printed at Bottom)</label>
                  <textarea
                    rows={3}
                    value={formData.receipt_terms}
                    onChange={(e) => setFormData(prev => ({ ...prev, receipt_terms: e.target.value }))}
                    className="field-textarea w-full font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Receipt Footer Note</label>
                  <input
                    type="text"
                    value={formData.receipt_footer}
                    onChange={(e) => setFormData(prev => ({ ...prev, receipt_footer: e.target.value }))}
                    className="field-input w-full"
                  />
                </div>
              </div>
            </div>

            {/* Automated Backup Settings */}
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs">
              <div className="flex items-center space-x-2">
                <Shield className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Automated Backup Settings</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Automatic Backups</label>
                  <div className="w-full bg-slate-50 dark:bg-surface-inset-dark border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-600 dark:text-slate-400 flex items-center">
                    <Lock className="w-4 h-4 mr-1 text-amber-500" />
                    Frequency is set by the Developer; choose the time of day under Backup & Recovery
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Default Auto Backup Folder</label>
                  <input
                    type="text"
                    value={formData.auto_backup_dir}
                    onChange={(e) => setFormData(prev => ({ ...prev, auto_backup_dir: e.target.value }))}
                    className="field-input w-full font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Counter Sale & POS Discount Policy */}
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs">
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
                      className="field-input w-32 font-mono font-bold"
                    />
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">%</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                    Sets the maximum overall bill discount percentage cashiers are permitted to apply at the POS counter. Any value typed above this limit (e.g. typing 15% when limit is 14%) will be automatically blocked and clamped.
                  </p>
                </div>
              </div>
            </div>

            {/* WhatsApp messages */}
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs">
              <div className="flex items-center space-x-2">
                <MessageCircle className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">WhatsApp Messages</h2>
              </div>
              <p className="field-hint">
                The text that opens in WhatsApp when you send a receipt or a khata reminder. Words in braces are filled in for each customer.
              </p>
              {composeWhatsAppCredit(formData) && (
                <p className="field-hint">
                  Every message also ends with the software line: <span className="font-semibold">{composeWhatsAppCredit(formData)}</span>
                </p>
              )}
              {([
                { key: 'whatsapp_receipt_template', label: 'Receipt message', fallback: DEFAULT_WHATSAPP_RECEIPT_TEMPLATE, placeholders: RECEIPT_PLACEHOLDERS },
                { key: 'whatsapp_reminder_template', label: 'Khata reminder message', fallback: DEFAULT_WHATSAPP_REMINDER_TEMPLATE, placeholders: REMINDER_PLACEHOLDERS }
              ] as const).map(t => (
                <div key={t.key}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label htmlFor={t.key} className="field-label mb-0">{t.label}</label>
                    <button type="button" onClick={() => setFormData(prev => ({ ...prev, [t.key]: t.fallback }))} className="btn-secondary btn-sm">
                      <RotateCcw className="w-4 h-4" />
                      <span>Reset to default</span>
                    </button>
                  </div>
                  <textarea
                    id={t.key}
                    rows={7}
                    maxLength={WHATSAPP_TEMPLATE_MAX}
                    value={formData[t.key] ?? t.fallback}
                    onChange={(e) => setFormData(prev => ({ ...prev, [t.key]: e.target.value }))}
                    className="field-textarea w-full"
                  />
                  <p className="field-hint">You can use: {t.placeholders.map(p => `{${p}}`).join(', ')}. Left blank, the default message is sent.</p>
                </div>
              ))}
            </div>
          </form>
        </div>
      )}

      {/* TAB 2: INVOICE SETTINGS & TEMPLATES */}
      {activeTab === 'invoice' && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="bg-linear-to-r from-teal-900/40 via-slate-900 to-slate-900 border border-teal-800/40 rounded-xl p-5 shadow-xs">
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
                  <Sparkles className="w-4 h-4" />
                  <span>Enable All Fields</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetInvoiceDefaults}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Reset Defaults</span>
                </button>
              </div>
            </div>
          </div>

          {/* Split-Screen Settings & Live Preview */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Left Column: Controls & Configuration */}
            <form onSubmit={handleSaveSettings} className="xl:col-span-7 space-y-6">
              {/* Card 1: Thermal Template & Roll Width Selection */}
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Receipt className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Default Thermal Receipt Design</h3>
                  </div>
                  <span className="text-2xs font-bold text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/60 px-2 py-0.5 rounded-full border border-teal-200 dark:border-teal-800/60">
                    Active: {TEMPLATE_LABELS[normalizeTemplate(formData.default_invoice_template)]} · {normalizePaperSize(formData.invoice_paper_size)}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  {TEMPLATE_CARDS.map(card => {
                    const Icon = card.icon;
                    const isSelected = normalizeTemplate(formData.default_invoice_template) === card.id;
                    return (
                      <div
                        key={card.id}
                        onClick={() => {
                          setFormData(prev => ({ ...prev, default_invoice_template: card.id }));
                          setPreviewTemplate(card.id);
                        }}
                        className={`cursor-pointer rounded-xl p-3.5 border transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'bg-teal-50/70 dark:bg-teal-950/20 border-teal-500 shadow-xs ring-1 ring-teal-500'
                            : 'bg-slate-50/60 dark:bg-surface-inset-dark border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300">
                              <Icon className="w-4 h-4" />
                            </div>
                            {isSelected && (
                              <span className="p-1 bg-teal-600 text-white rounded-full">
                                <Check className="w-4 h-4" />
                              </span>
                            )}
                          </div>
                          <div className="mt-2.5">
                            <span className="text-xs font-bold text-slate-900 dark:text-white block">{card.title}</span>
                            <span className="text-2xs text-teal-600 dark:text-teal-400 font-mono">58 mm / 80 mm Roll</span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                            {card.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Thermal Roll Width (58mm / 80mm only) */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Thermal Roll Width
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {INVOICE_PAPER_SIZES.map(size => {
                      const isSelected = normalizePaperSize(formData.invoice_paper_size) === size;
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => {
                            setFormData(prev => ({ ...prev, invoice_paper_size: size, paper_width: size }));
                            setPreviewPaperSize(size);
                          }}
                          className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-teal-600 border-teal-600 text-white shadow-xs'
                              : 'bg-slate-50 dark:bg-surface-inset-dark border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-teal-500'
                          }`}
                        >
                          {size === '80mm' ? '80 mm · Standard POS roll' : '58 mm · Compact POS roll'}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                    Receipts are thermal-only. The roll width applies to every counter, for every sale and reprint.
                  </p>
                </div>
              </div>

              <ReceiptPrinterCard getTestReceipt={() => previewMountRef.current?.querySelector<HTMLElement>('#thermal-receipt-printable') ?? null} />

              {/* Card 2: Field Visibility Checkboxes */}
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5 shadow-xs">
                <div className="flex items-center space-x-2">
                  <Sliders className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Printable Field Visibility Controls</h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Enable or disable individual fields on printed receipts. Hiding a field changes its presentation visibility only; all accounting calculations and transaction records remain 100% intact.
                </p>

                {/* Section 1: Store & Invoice Information */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
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
                      const isLocked = PROTECTED_IDENTITY_FIELDS.includes(field.key) && !canHideStoreIdentity;
                      const isChecked = isLocked || formData[field.key] !== 'false';
                      return (
                        <div
                          key={field.key}
                          onClick={() => handleToggleField(field.key)}
                          title={isLocked ? 'Protected by Developer: store identity must appear on every receipt' : undefined}
                          className={`flex items-center justify-between p-2 rounded-lg border transition-colors ${
                            isLocked
                              ? 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                              : 'bg-slate-50 dark:bg-surface-inset-dark hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer border-slate-200 dark:border-slate-800/70'
                          }`}
                        >
                          <div className="flex items-center space-x-2.5">
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <span className={`text-xs ${isChecked ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-500'}`}>
                              {field.label}
                            </span>
                          </div>
                          {isLocked && (
                            <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-sm text-2xs font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                              <Lock className="w-2.5 h-2.5" />
                              <span>Protected</span>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Section 2: Cashier & Customer Information */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
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
                          className="flex items-center space-x-2.5 p-2 rounded-lg bg-slate-50 dark:bg-surface-inset-dark hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors border border-slate-200 dark:border-slate-800/70"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
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
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
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
                          className="flex items-center space-x-2.5 p-2 rounded-lg bg-slate-50 dark:bg-surface-inset-dark hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors border border-slate-200 dark:border-slate-800/70"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
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
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
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
                          className="flex items-center space-x-2.5 p-2 rounded-lg bg-slate-50 dark:bg-surface-inset-dark hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors border border-slate-200 dark:border-slate-800/70"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
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
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
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
                          className="flex items-center space-x-2.5 p-2 rounded-lg bg-slate-50 dark:bg-surface-inset-dark hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors border border-slate-200 dark:border-slate-800/70"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <span className={`text-xs ${isChecked ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-500'}`}>
                            {field.label}
                          </span>
                        </div>
                      );
                    })}

                    {/* Developer Footer (MANDATORY & MANAGED BY DEVELOPER) */}
                    <div className="sm:col-span-2 p-2 rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs cursor-not-allowed space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2.5">
                          <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                          <span className="font-semibold text-slate-900 dark:text-white">Developer Footer (managed by Developer)</span>
                        </div>
                        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-sm text-2xs font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                          <Lock className="w-2.5 h-2.5" />
                          <span>Mandatory</span>
                        </span>
                      </div>
                      <p className="pl-6 text-xs text-slate-500 dark:text-slate-400 font-mono whitespace-pre-wrap wrap-anywhere">
                        {formData.developer_invoice_footer || DEFAULT_DEVELOPER_FOOTER}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 3: Return & Exchange Policy Editor */}
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 shadow-xs">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Return & Exchange Policy Text (Printed on Invoices)
                </label>
                <textarea
                  rows={3}
                  value={formData.return_policy_text || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, return_policy_text: e.target.value }))}
                  placeholder="Enter detailed pharmacy return and exchange instructions..."
                  className="field-textarea w-full font-mono"
                />
              </div>

              {/* Save Button */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving Settings...' : 'Save Invoice Configuration'}</span>
                </button>
              </div>
            </form>

            {/* Right Column: Live Interactive Preview */}
            <div className="xl:col-span-5 sticky top-6 space-y-4">
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center space-x-2">
                    <Eye className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Live Print Preview
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    {TEMPLATE_CARDS.map(card => (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => setPreviewTemplate(card.id)}
                        className={`px-2 py-0.5 rounded text-2xs font-bold transition-all cursor-pointer ${
                          previewTemplate === card.id
                            ? 'bg-teal-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {TEMPLATE_LABELS[card.id]}
                      </button>
                    ))}
                    <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                    {INVOICE_PAPER_SIZES.map(size => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setPreviewPaperSize(size)}
                        className={`px-2 py-0.5 rounded text-2xs font-bold transition-all cursor-pointer ${
                          previewPaperSize === size
                            ? 'bg-teal-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {previewTemplate !== normalizeTemplate(formData.default_invoice_template) ||
                  previewPaperSize !== normalizePaperSize(formData.invoice_paper_size) ? (
                    <span className="text-amber-600 dark:text-amber-400 font-semibold">
                      Preview only. Selected design: {TEMPLATE_LABELS[normalizeTemplate(formData.default_invoice_template)]} · {normalizePaperSize(formData.invoice_paper_size)}
                    </span>
                  ) : normalizeTemplate(formData.default_invoice_template) !== normalizeTemplate(settings?.default_invoice_template) ||
                    normalizePaperSize(formData.invoice_paper_size) !== normalizePaperSize(settings?.invoice_paper_size) ? (
                    <span className="text-amber-600 dark:text-amber-400 font-semibold">Unsaved changes. Save to apply to all receipts.</span>
                  ) : (
                    'Preview updates live with the selected fields, design and roll width.'
                  )}
                </div>

                {/* Preview Paper Mount Area */}
                <div ref={previewMountRef} className="bg-slate-100 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-center max-h-[750px] overflow-y-auto">
                  <UnifiedInvoice
                    invoice={MOCK_PREVIEW_INVOICE}
                    settings={{
                      ...formData,
                      ...(canHideStoreIdentity ? {} : { show_store_name: 'true', show_store_address: 'true' })
                    }}
                    templateOverride={previewTemplate}
                    paperSizeOverride={previewPaperSize}
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
        <UsersTab users={users} roles={roles} settings={settings} onChanged={refreshUsersAndRoles} notify={notify} />
      )}

      {activeTab === 'roles' && <RolesTab roles={roles} onChanged={refreshUsersAndRoles} notify={notify} />}

      {activeTab === 'loyalty' && showLoyalty && (
        <LoyaltySettingsTab settings={settings} money={moneyFormatter(settings)} onRefreshSettings={onRefreshSettings} />
      )}
    </div>
  );
};
