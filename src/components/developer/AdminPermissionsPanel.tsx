import React, { useEffect, useState } from 'react';
import { api } from '../../services/apiService';
import { PERMISSION_GROUPS } from '../../utils/permissions';
import { ListChecks, CheckSquare, Square, Save, AlertTriangle, CheckCircle2 } from 'lucide-react';

// Developer-only: what the Admin role may do. Admins cannot edit their own role.
export const AdminPermissionsPanel: React.FC = () => {
  const [permissions, setPermissions] = useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.getAdminPermissions().then(setPermissions).catch(err => setMessage({ ok: false, text: err.message }));
  }, []);

  const save = async () => {
    if (!permissions) return;
    try {
      setSaving(true);
      setMessage(null);
      const res = await api.updateAdminPermissions(permissions);
      setPermissions(res.permissions);
      setMessage({ ok: true, text: 'Admin permissions saved. Admins see the change at their next sign-in.' });
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || 'Failed to save admin permissions' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5 shadow-xs">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
            <ListChecks className="w-5 h-5 text-purple-500" />
            <span>Admin Permissions</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Decide what the store Admin can do. Cashier and custom roles are managed by the Admin in Settings.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || !permissions}
          className="flex items-center space-x-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving...' : 'Save'}</span>
        </button>
      </div>

      {message && (
        <div className={`p-3 rounded-xl flex items-center space-x-2 text-xs font-semibold ${message.ok ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400'}`}>
          {message.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {permissions && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {PERMISSION_GROUPS.map(group => (
            <div key={group.title} className="p-3 bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 rounded-xl">
              <span className="font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider text-[11px] block mb-2">{group.title}</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {group.items.map(item => (
                  <label
                    key={item.key}
                    onClick={() => setPermissions(prev => (prev ? { ...prev, [item.key]: !prev[item.key] } : prev))}
                    className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-purple-500/5"
                  >
                    {permissions[item.key] ? <CheckSquare className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" /> : <Square className="w-4 h-4 text-slate-400 shrink-0" />}
                    <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
