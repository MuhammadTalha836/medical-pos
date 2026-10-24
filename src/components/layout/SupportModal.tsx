import React from 'react';
import { Building2, Globe, Info, Mail, MessageCircle, Phone, User } from 'lucide-react';
import { Modal } from '../common/Modal';
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
}

/** Who to call for help with the software: the Developer's details chosen for the Support window. */
export const SupportModal: React.FC<SupportModalProps> = ({ isOpen, onClose, settings }) => {
  const items = developerInfoFor(settings, 'about');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Software Support" maxWidth="max-w-md">
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        For help, training or problems with PharmaCare Pro, contact:
      </p>
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

