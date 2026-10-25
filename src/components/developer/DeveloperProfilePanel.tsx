import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Megaphone, MessageCircle, Save } from 'lucide-react';
import { api } from '../../services/apiService';
import {
  DEFAULT_DEVELOPER_PROFILE_SETTINGS,
  DEVELOPER_INFO_PLACEMENTS,
  DEVELOPER_PROFILE_FIELDS,
  DEVELOPER_PROFILE_SETTING_KEYS,
  WHATSAPP_CREDIT_LEAD_MAX,
  WHATSAPP_CREDIT_LEAD_SETTING,
  composeInvoiceFooter,
  composeWhatsAppCredit,
  developerInfoFor,
  parseInfoFields,
  type DeveloperField
} from '../../../shared/developerProfile';
import { DeveloperCredit } from '../common/DeveloperCredit';

const PLACEHOLDERS: Record<DeveloperField, string> = {
  name: 'e.g. Muhammad Talha',
  company: 'e.g. Talha Software House',
  phone: 'e.g. 0300-1234567',
  whatsapp: 'e.g. 0300-1234567',
  email: 'e.g. support@example.com',
  website: 'e.g. www.example.com',
  tagline: 'e.g. Custom software for pharmacies & shops'
};

// The WhatsApp placement has its own section below the table
const TABLE_PLACEMENTS = DEVELOPER_INFO_PLACEMENTS.filter(p => p.key !== 'whatsapp');
const WHATSAPP_PLACEMENT = DEVELOPER_INFO_PLACEMENTS.find(p => p.key === 'whatsapp')!;

interface DeveloperProfilePanelProps {
  /** Reloads the app-wide settings so the sidebar, receipts and Support window update at once */
  onSaved?: () => void;
}

// Developer-only: contact details (advertising) and where each detail is shown in the app
export const DeveloperProfilePanel: React.FC<DeveloperProfilePanelProps> = ({ onSaved }) => {
  const [profile, setProfile] = useState<Record<string, string>>(DEFAULT_DEVELOPER_PROFILE_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.getDeveloperSettings()
      .then(res => setProfile(prev => ({
        ...prev,
        ...Object.fromEntries(DEVELOPER_PROFILE_SETTING_KEYS.map(key => [key, res[key] ?? prev[key]]))
      })))
      .catch(err => setMessage({ ok: false, text: err.message || 'Failed to load the developer profile' }));
  }, []);

  const setValue = (key: string, value: string) => setProfile(prev => ({ ...prev, [key]: value }));

  const togglePlacement = (setting: string, field: DeveloperField) => {
    const fields = new Set(parseInfoFields(profile[setting]));
    if (fields.has(field)) fields.delete(field);
    else fields.add(field);
    setValue(setting, parseInfoFields([...fields].join(',')).join(','));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setBusy(true);
      setMessage(null);
      await api.updateDeveloperSettings(Object.fromEntries(DEVELOPER_PROFILE_SETTING_KEYS.map(key => [key, profile[key] ?? ''])));
      setMessage({ ok: true, text: 'Developer profile saved. New sales print the updated receipt line.' });
      onSaved?.();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || 'Failed to save the developer profile' });
    } finally {
      setBusy(false);
    }
  };

  const receiptLines = composeInvoiceFooter(profile).split('\n').slice(1);
  const supportItems = developerInfoFor(profile, 'about');
  const whatsappCredit = composeWhatsAppCredit(profile);
  const whatsappFields = parseInfoFields(profile[WHATSAPP_PLACEMENT.setting]);

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="card-premium p-6 space-y-6">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-purple-500" />
            <span>Developer Profile & Advertising</span>
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Your contact details are shown inside the pharmacy's software. Choose below which details appear in each place.
            Store staff cannot change or hide them.
          </p>
        </div>

        {message && (
          <div className={`p-3 rounded-xl flex items-center gap-2 text-sm font-semibold border ${message.ok
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
            : 'bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-400'}`}>
            {message.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        {/* Contact details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {DEVELOPER_PROFILE_FIELDS.map(field => (
            <label key={field.key} className={field.key === 'tagline' ? 'md:col-span-2' : undefined}>
              <span className="field-label">{field.label}</span>
              <input
                type={field.key === 'email' ? 'email' : 'text'}
                maxLength={field.maxLength}
                value={profile[field.setting] ?? ''}
                placeholder={PLACEHOLDERS[field.key]}
                onChange={e => setValue(field.setting, e.target.value)}
                className="field-input w-full"
              />
            </label>
          ))}
        </div>

        {/* Where each detail is shown */}
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Where to show each detail</h4>
          <div className="table-container overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-[#0d131f] text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Detail</th>
                  {TABLE_PLACEMENTS.map(p => (
                    <th key={p.key} className="px-4 py-2.5 font-semibold text-center">{p.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {DEVELOPER_PROFILE_FIELDS.map(field => (
                  <tr key={field.key}>
                    <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">{field.label}</td>
                    {TABLE_PLACEMENTS.map(p => (
                      <td key={p.key} className="px-4 py-2.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Show ${field.label} on the ${p.label}`}
                          checked={parseInfoFields(profile[p.setting]).includes(field.key)}
                          onChange={() => togglePlacement(p.setting, field.key)}
                          className="w-5 h-5 accent-teal-600 cursor-pointer"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* WhatsApp advertising */}
        <div className="card-surface p-4 space-y-4">
          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>WhatsApp Advertising</span>
            </h4>
            <p className="field-hint">
              Added as the last line of every WhatsApp message the store sends (receipts, khata reminders, supplier orders).
              Store staff cannot edit or remove it. Untick every detail to stop it.
            </p>
          </div>
          <label className="block">
            <span className="field-label">Text before your details</span>
            <input
              type="text"
              maxLength={WHATSAPP_CREDIT_LEAD_MAX}
              value={profile[WHATSAPP_CREDIT_LEAD_SETTING] ?? ''}
              placeholder="e.g. Software built and developed by"
              onChange={e => setValue(WHATSAPP_CREDIT_LEAD_SETTING, e.target.value)}
              className="field-input w-full"
            />
          </label>
          <div>
            <span className="field-label">Details to add</span>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {DEVELOPER_PROFILE_FIELDS.map(field => (
                <label key={field.key} className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={whatsappFields.includes(field.key)}
                    onChange={() => togglePlacement(WHATSAPP_PLACEMENT.setting, field.key)}
                    className="w-5 h-5 accent-teal-600 cursor-pointer"
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="field-label">Preview (end of a message)</span>
            <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
              {whatsappCredit || <span className="text-slate-400">Nothing added. Fill in your details above and tick at least one.</span>}
            </div>
          </div>
        </div>

        {/* Previews */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card-surface p-4 space-y-2">
            <div className="field-label">Login screen</div>
            <DeveloperCredit settings={profile} placement="login" />
            {developerInfoFor(profile, 'login').length === 0 && <p className="text-xs text-slate-400">Nothing shown</p>}
          </div>
          <div className="card-surface p-4 space-y-2">
            <div className="field-label">Sale receipt (last lines)</div>
            <div className="font-mono text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
              {receiptLines.length > 0 ? receiptLines.join('\n') : <span className="text-slate-400">Nothing shown</span>}
            </div>
          </div>
          <div className="card-surface p-4 space-y-2">
            <div className="field-label">Sidebar</div>
            <div className="max-w-60">
              <DeveloperCredit settings={profile} placement="sidebar" />
            </div>
            {developerInfoFor(profile, 'sidebar').length === 0 && <p className="text-xs text-slate-400">Nothing shown</p>}
          </div>
          <div className="card-surface p-4 space-y-2">
            <div className="field-label">Support window</div>
            {supportItems.length > 0
              ? supportItems.map(item => (
                <div key={item.key} className="text-sm"><span className="text-slate-500">{item.label}:</span> <span className="font-semibold">{item.value}</span></div>
              ))
              : <p className="text-xs text-slate-400">Nothing shown (the Support button stays hidden)</p>}
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="btn-primary">
            <Save className="w-4 h-4" />
            <span>{busy ? 'Saving…' : 'Save Developer Profile'}</span>
          </button>
        </div>
      </div>
    </form>
  );
};
