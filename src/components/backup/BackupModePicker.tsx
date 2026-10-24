import React from 'react';
import { Cloud, HardDrive, Layers } from 'lucide-react';
import { BACKUP_MODES, BACKUP_MODE_LABELS, ONLINE_LOCAL_KEEP, type BackupMode } from '../../../shared/backup';

const MODE_DETAILS: Record<BackupMode, { icon: React.ElementType; hint: string }> = {
  offline: { icon: HardDrive, hint: 'Backups stay in the backup folder on this computer (and the second folder, if set).' },
  online: { icon: Cloud, hint: `Backups go to the owner's Google Drive. Only the newest ${ONLINE_LOCAL_KEEP} stay on this computer.` },
  both: { icon: Layers, hint: 'Backups stay on this computer and a copy goes to the owner\'s Google Drive. Safest choice.' }
};

interface BackupModePickerProps {
  value: BackupMode;
  onChange: (mode: BackupMode) => void;
  /** False when this build cannot upload to Google Drive: only Offline can be chosen */
  onlineAvailable: boolean;
}

// Backup type: Offline / Online / Both, chosen by the Developer
export const BackupModePicker: React.FC<BackupModePickerProps> = ({ value, onChange, onlineAvailable }) => (
  <div role="radiogroup" aria-label="Backup type" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
    {BACKUP_MODES.map(mode => {
      const { icon: Icon, hint } = MODE_DETAILS[mode];
      const disabled = mode !== 'offline' && !onlineAvailable;
      const selected = value === mode;
      return (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={selected}
          disabled={disabled}
          onClick={() => onChange(mode)}
          className={`text-left p-3 rounded-xl border-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            selected
              ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40'
              : 'border-slate-200 dark:border-slate-700 hover:border-teal-400'
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Icon className={`w-4 h-4 ${selected ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400'}`} />
            {BACKUP_MODE_LABELS[mode]}
          </span>
          <span className="block text-2xs text-slate-500 dark:text-slate-400 mt-1">
            {disabled ? 'Not available in this build.' : hint}
          </span>
        </button>
      );
    })}
  </div>
);
