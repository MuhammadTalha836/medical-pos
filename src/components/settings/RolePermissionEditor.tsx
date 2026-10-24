import React from 'react';
import { CheckSquare, Square } from 'lucide-react';
import {
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_BLANK_PERMISSIONS,
  DEFAULT_CASHIER_PERMISSIONS,
  PERMISSION_GROUPS,
  type PermissionKey,
  type RolePermissions
} from '../../../shared/permissions';

// The Administrator role must keep these, or nobody could manage settings, roles or users
const ADMIN_REQUIRED_KEYS: PermissionKey[] = ['settings', 'can_manage_roles', 'can_manage_users'];

interface RolePermissionEditorProps {
  title: string;
  permissions: RolePermissions;
  onChange: (permissions: RolePermissions) => void;
  isAdminRole?: boolean;
}

/** Checkbox matrix with presets, used by the Add Role and Edit Role dialogs. */
export const RolePermissionEditor: React.FC<RolePermissionEditorProps> = ({ title, permissions, onChange, isAdminRole = false }) => {
  const toggle = (key: PermissionKey) => {
    if (isAdminRole && ADMIN_REQUIRED_KEYS.includes(key)) {
      alert('Administrator role must retain settings and role/user management permissions.');
      return;
    }
    onChange({ ...permissions, [key]: !permissions[key] });
  };

  const presetButton = 'px-2.5 py-1 text-[11px] rounded-sm bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300';

  return (
    <>
      <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
        <span className="font-bold text-slate-900 dark:text-white text-sm">{title}</span>
        <div className="flex items-center space-x-2">
          <button type="button" onClick={() => onChange({ ...DEFAULT_ADMIN_PERMISSIONS })} className={presetButton}>
            Select All
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_CASHIER_PERMISSIONS })}
            className="px-2.5 py-1 text-[11px] rounded-sm bg-teal-500/10 hover:bg-teal-500/20 text-teal-700 dark:text-teal-300 border border-teal-500/30"
          >
            Cashier Preset
          </button>
          {!isAdminRole && (
            <button type="button" onClick={() => onChange({ ...DEFAULT_BLANK_PERMISSIONS })} className={presetButton}>
              Clear All
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
        {PERMISSION_GROUPS.map((group, index) => (
          <div
            key={group.title}
            className="p-3 bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 rounded-xl space-y-2"
          >
            <span className="font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider text-[11px] block">
              {index + 1}. {group.title}
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {group.items.map(item => (
                <label
                  key={item.key}
                  onClick={() => toggle(item.key)}
                  className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors"
                >
                  {permissions[item.key] ? (
                    <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
};
