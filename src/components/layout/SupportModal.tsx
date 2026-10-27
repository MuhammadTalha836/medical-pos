import React from 'react';
import { Building2, Globe, Info, Mail, MessageCircle, Phone, User } from 'lucide-react';
import { Modal } from '../common/Modal';
import { AppLogo } from '../common/AppLogo';
import { developerInfoFor, type DeveloperField } from '../../../shared/developerProfile';

const FIELD_ICONS: Record<DeveloperField, React.ElementType> = {
  name: User,
  company: Building2,
  phone: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  website: Globe,
  tagline: Info
};

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: object | null | undefined;
  /** The running app's version (from the server), or null while unknown */
  version: string | null;
}

/** About the software (name, version, copyright) and whom to call for help: the Developer's chosen details. */
export const SupportModal: React.FC<SupportModalProps> = ({ isOpen, onClose, settings, version }) => {
  const items = developerInfoFor(settings, 'about');
  const profile = (settings ?? {}) as Record<string, string | undefined>;
  const owner = profile.developer_company || profile.developer_name || 'PharmaCare Pro';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="About & Support" maxWidth="max-w-md">
      <div className="flex items-center gap-4 pb-4 mb-4 border-b border-slate-200 dark:border-slate-800">
        <AppLogo className="w-14 h-14 shrink-0" />
        <div>
          <div className="text-lg font-extrabold text-slate-900 dark:text-white">PharmaCare Pro</div>
          <div className="text-sm text-slate-500 dark:text-slate-400">100% Offline POS</div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-1">Version {version ?? '…'}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">© {new Date().getFullYear()} {owner}. All rights reserved.</div>
        </div>
      </div>
      {items.length > 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          For help, training or problems with PharmaCare Pro, contact:
        </p>
      )}
      <ul className="space-y-2 select-text">
        {items.map(item => {
          const Icon = FIELD_ICONS[item.key];
          return (
            <li key={item.key} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800">
              <Icon className="w-5 h-5 mt-0.5 shrink-0 text-teal-600 dark:text-teal-400" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{item.label}</div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white break-words">{item.value}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
};

