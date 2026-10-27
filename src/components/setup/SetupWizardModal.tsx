import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/apiService';
import { useAuthStore } from '../../store/useAuthStore';
import { BackupFrequency, BackupMode, SetupCompletePayload } from '../../types';
import { BackupModePicker } from '../backup/BackupModePicker';
import { GoogleDriveConnect, DriveConnectionState } from '../backup/GoogleDriveConnect';
import { BACKUP_MODE_LABELS, usesCloud } from '../../../shared/backup';
import { BACKUP_FREQUENCY_LABELS, WEEKDAY_LABELS, describeBackupSchedule } from '../../utils/backup';
import {
  ADMIN_POLICY_TOGGLES,
  PERMISSION_GROUPS
} from '../../utils/permissions';
import { DEFAULT_ADMIN_PERMISSIONS } from '../../../shared/permissions';
import {
  ShieldCheck,
  Building,
  MapPin,
  Mail,
  Lock,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  UserCog,
  User,
  HardDrive,
  FolderOpen,
  Clock,
  ListChecks,
  CalendarClock,
  BadgeCheck,
  CheckSquare,
  Square
} from 'lucide-react';

interface SetupWizardModalProps {
  isOpen: boolean;
  onCompleted: () => void;
}

// Step 1 unlocks the wizard with the developer's authenticator code; nothing else is shown before that
const STEPS = ['Developer', 'Store', 'Admin', 'Backups', 'Permissions', 'License', 'Review'] as const;

const inputClass =
  'field-input w-full pl-9';
const labelClass = 'field-label';

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({ isOpen, onCompleted }) => {
  const { setUser } = useAuthStore();
  const [step, setStep] = useState(0);

  // Developer unlock
  const [developerEmail, setDeveloperEmail] = useState('');
  const [keyConfigured, setKeyConfigured] = useState(true);
  const [unlockCode, setUnlockCode] = useState('');
  const [setupToken, setSetupToken] = useState('');

  // Store identity
  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');

  // Admin account
  const [adminFullName, setAdminFullName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');

  // Backups
  const [backupMode, setBackupMode] = useState<BackupMode>('offline');
  const [onlineAvailable, setOnlineAvailable] = useState(false);
  const [drive, setDrive] = useState<DriveConnectionState | null>(null);
  const [backupDir, setBackupDir] = useState('');
  const [backupFrequency, setBackupFrequency] = useState<BackupFrequency>('daily');
  const [backupTime, setBackupTime] = useState('23:00');
  const [backupWeekday, setBackupWeekday] = useState(0);

  // Admin permissions & policies
  const [adminPermissions, setAdminPermissions] = useState<Record<string, boolean>>({ ...DEFAULT_ADMIN_PERMISSIONS });
  const [policies, setPolicies] = useState<SetupCompletePayload['policies']>({
    allow_admin_create_cashier: true,
    allow_admin_create_admin: false,
    allow_admin_edit_store_identity: false,
    allow_admin_hide_store_identity: false
  });

  // License
  const [licenseMode, setLicenseMode] = useState<'demo' | 'full'>('demo');
  const [demoDays, setDemoDays] = useState(14);

  // UI
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    api.getSetupStatus()
      .then(status => {
        setDeveloperEmail(status.developerEmail || '');
        setKeyConfigured(status.developerKeyConfigured !== false);
        setOnlineAvailable(status.onlineBackupAvailable === true);
      })
      .catch(err => setErrorMsg(`Could not load setup status: ${err.message}`));
  }, [isOpen]);

  // Google Drive sign-in during setup is authorized by the setup token (no developer session yet)
  const getDriveStatus = useCallback(() => api.getCloudBackupSetupStatus(setupToken), [setupToken]);
  const startDriveConnect = useCallback(() => api.connectCloudBackupInSetup(setupToken), [setupToken]);

  if (!isOpen) return null;

  const goTo = (next: number) => {
    setErrorMsg(null);
    setStep(next);
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(unlockCode)) {
      setErrorMsg('Enter the 6-digit code from the developer authenticator app.');
      return;
    }
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await api.unlockSetup(unlockCode);
      setSetupToken(res.setupToken);
      setDeveloperEmail(res.developerEmail);
      setUnlockCode('');
      setStep(1);
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not verify the developer code.');
      setUnlockCode('');
    } finally {
      setLoading(false);
    }
  };

  // Per-step checks before moving on (the server validates everything again on completion)
  const validateStep = (current: number): string | null => {
    if (current === 1) {
      if (!storeName.trim()) return 'Enter the medical store name.';
      if (!storeAddress.trim()) return 'Enter the store address.';
    }
    if (current === 2) {
      if (!adminFullName.trim()) return "Enter the admin's full name.";
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(adminUsername.trim())) return 'Admin username must be 3-32 letters, digits, dot, dash or underscore.';
      if (adminPassword.length < 8) return 'Admin password must be at least 8 characters.';
      if (adminPassword !== adminPasswordConfirm) return 'The two admin passwords do not match.';
    }
    if (current === 3) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(backupTime)) return 'Backup time must use 24-hour HH:MM format.';
      if (usesCloud(backupMode) && !drive?.connected) return 'Connect the owner\'s Google Drive, or choose Offline backups for now.';
    }
    if (current === 5 && licenseMode === 'demo') {
      if (!Number.isInteger(demoDays) || demoDays < 1 || demoDays > 365) return 'Demo days must be a whole number from 1 to 365.';
    }
    return null;
  };

  const handleNext = () => {
    const problem = validateStep(step);
    if (problem) {
      setErrorMsg(problem);
      return;
    }
    goTo(step + 1);
  };

  const handleSelectFolder = async () => {
    if (window.electronAPI?.selectBackupDir) {
      const selected = await window.electronAPI.selectBackupDir();
      if (selected) setBackupDir(selected);
    }
  };

  const handleComplete = async () => {
    for (const s of [1, 2, 3, 5]) {
      const problem = validateStep(s);
      if (problem) {
        setErrorMsg(problem);
        setStep(s);
        return;
      }
    }
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await api.completeSetup({
        setupToken,
        storeName: storeName.trim(),
        storeAddress: storeAddress.trim(),
        admin: { fullName: adminFullName.trim(), username: adminUsername.trim(), password: adminPassword },
        backup: {
          dir: backupDir.trim() || undefined,
          mode: backupMode,
          frequency: backupFrequency,
          time: backupTime,
          weeklyDay: backupWeekday
        },
        adminPermissions,
        policies,
        license: licenseMode === 'demo' ? { mode: 'demo', demoDays } : { mode: 'full' }
      });
      setAdminPassword('');
      setAdminPasswordConfirm('');
      setUser(res.user, res.token);
      onCompleted();
    } catch (err: any) {
      setErrorMsg(err.message || 'Setup could not be completed.');
      // An expired setup session must be unlocked again with a fresh code
      if (/unlock the wizard/i.test(err.message || '')) {
        setSetupToken('');
        setStep(0);
      }
    } finally {
      setLoading(false);
    }
  };

  const togglePermission = (key: string) => setAdminPermissions(prev => ({ ...prev, [key]: !prev[key] }));

  const reviewRows: Array<[string, string]> = [
    ['Developer', developerEmail],
    ['Store', `${storeName.trim()} — ${storeAddress.trim()}`],
    ['Admin', `${adminFullName.trim()} (${adminUsername.trim()})`],
    ['Backup type', `${BACKUP_MODE_LABELS[backupMode]}${usesCloud(backupMode) && drive?.account_email ? ` — ${drive.account_email}` : ''}`],
    ['Backup folder', backupDir.trim() || 'Default app folder'],
    ['Automatic backups', describeBackupSchedule(backupFrequency, backupTime, backupWeekday)],
    ['Admin permissions', `${Object.values(adminPermissions).filter(Boolean).length} of ${Object.keys(adminPermissions).length} allowed`],
    ['License', licenseMode === 'demo' ? `Demo for ${demoDays} day(s)` : 'Full version']
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-xl select-none">
      <div className="w-full max-w-2xl max-h-[95vh] bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header Ribbon */}
        <div className="p-5 bg-linear-to-r from-teal-600 via-teal-700 to-emerald-700 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-lg font-black tracking-tight">PharmaCare Pro</h2>
                  <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-emerald-400 text-emerald-950">
                    Installation Setup
                  </span>
                </div>
                <p className="text-xs text-teal-100 mt-0.5">Only the developer can complete this setup</p>
              </div>
            </div>
            <span className="text-xs font-semibold px-3 py-1 bg-white/15 rounded-xl border border-white/20">
              Step {step + 1} of {STEPS.length}
            </span>
          </div>
          {setupToken && (
            <div className="flex mt-4 gap-1">
              {STEPS.map((label, i) => (
                <div key={label} className="flex-1">
                  <div className={`h-1 rounded-full ${i <= step ? 'bg-white' : 'bg-white/25'}`} />
                  <span className={`text-2xs mt-1 block ${i === step ? 'text-white font-bold' : 'text-teal-100/70'}`}>{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {errorMsg && (
            <div className="flex items-start space-x-2.5 p-3.5 bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-xl text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {step === 0 && (
            <form onSubmit={handleUnlock} className="space-y-5">
              <div className="p-3.5 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800/80 rounded-xl text-xs text-teal-900 dark:text-teal-200 flex items-start space-x-2.5">
                <KeyRound className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                <span>
                  This installation is locked. Enter the 6-digit code from the <strong>developer's authenticator app</strong> to start the setup.
                  Store staff cannot set up the system.
                </span>
              </div>

              {!keyConfigured && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl text-xs text-amber-800 dark:text-amber-300">
                  This installation is missing the developer key. Please contact the developer.
                </div>
              )}

              <div>
                <label className={labelClass}>Developer Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input type="email" readOnly value={developerEmail} className={`${inputClass} opacity-80 cursor-not-allowed`} />
                </div>
              </div>

              <div>
                <label className={`${labelClass} text-center`}>Developer Authenticator Code</label>
                <div className="flex justify-center">
                  <input
                    type="text"
                    required
                    maxLength={6}
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={unlockCode}
                    onChange={(e) => setUnlockCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="field-input w-56 text-center text-2xl font-mono font-extrabold tracking-widest"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || unlockCode.length !== 6 || !keyConfigured}
                className="w-full py-2.5 bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs rounded-xl shadow-lg flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
              >
                <span>{loading ? 'Verifying...' : 'Unlock Setup'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {window.electronAPI && (
                <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                  Shop with more than one computer?{' '}
                  <button type="button" onClick={() => void window.electronAPI?.lanOpenCounterSetup()} className="font-semibold text-teal-700 dark:text-teal-400 hover:underline">
                    This computer is a counter
                  </button>
                  {' '}(connects to the main computer)
                </p>
              )}
            </form>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <SectionTitle icon={<Building className="w-4 h-4" />} title="Medical store identity" hint="Printed on every receipt." />
              <div>
                <label className={labelClass}>Medical Store Name <span className="text-rose-500">*</span></label>
                <div className="relative">
                  <Building className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input type="text" autoFocus maxLength={80} value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="e.g. Al-Shifa Pharmacy" className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Store Address <span className="text-rose-500">*</span></label>
                <div className="relative">
                  <MapPin className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input type="text" maxLength={160} value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} placeholder="e.g. Shop 4, Main Bazaar" className={inputClass} />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <SectionTitle icon={<UserCog className="w-4 h-4" />} title="Administrator account" hint="The store owner signs in with this username and password. No authenticator is needed." />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Full Name <span className="text-rose-500">*</span></label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input type="text" autoFocus value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)} placeholder="e.g. Dr. Ahmed Khan" className={inputClass} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Username <span className="text-rose-500">*</span></label>
                  <div className="relative">
                    <UserCog className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input type="text" autoComplete="off" value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} placeholder="e.g. owner" className={inputClass} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Password <span className="text-rose-500">*</span></label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input type="password" autoComplete="new-password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="At least 8 characters" className={`${inputClass} font-mono`} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Confirm Password <span className="text-rose-500">*</span></label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input type="password" autoComplete="new-password" value={adminPasswordConfirm} onChange={(e) => setAdminPasswordConfirm(e.target.value)} placeholder="Repeat password" className={`${inputClass} font-mono`} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <SectionTitle icon={<HardDrive className="w-4 h-4" />} title="Backups" hint="Verified automatic backups run while the app is open, and missed ones run at the next start." />
              <div className="space-y-3">
                <span className={labelClass}>Backup Type</span>
                <BackupModePicker value={backupMode} onChange={setBackupMode} onlineAvailable={onlineAvailable} />
                {usesCloud(backupMode) && setupToken && (
                  <GoogleDriveConnect getStatus={getDriveStatus} startConnect={startDriveConnect} onStatus={setDrive} />
                )}
              </div>
              <div>
                <label className={labelClass}>Backup Folder</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <FolderOpen className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input type="text" value={backupDir} onChange={(e) => setBackupDir(e.target.value)} placeholder="Leave empty for the default app folder, e.g. D:\PharmacyBackups" className={inputClass} />
                  </div>
                  {window.electronAPI?.selectBackupDir && (
                    <button type="button" onClick={handleSelectFolder} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl">
                      Browse
                    </button>
                  )}
                </div>
                <span className="text-2xs text-slate-400 mt-1 block">Prefer a second drive or a USB/cloud-synced folder, not the system drive.</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelClass}>Frequency</label>
                  <select value={backupFrequency} onChange={(e) => setBackupFrequency(e.target.value as BackupFrequency)} className="field-select w-full">
                    {(Object.keys(BACKUP_FREQUENCY_LABELS) as BackupFrequency[]).map(f => (
                      <option key={f} value={f}>{BACKUP_FREQUENCY_LABELS[f]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Time</label>
                  <div className="relative">
                    <Clock className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input type="time" value={backupTime} disabled={backupFrequency === 'off'} onChange={(e) => setBackupTime(e.target.value)} className={inputClass} />
                  </div>
                </div>
                {backupFrequency === 'weekly' && (
                  <div>
                    <label className={labelClass}>Day</label>
                    <select value={backupWeekday} onChange={(e) => setBackupWeekday(Number(e.target.value))} className="field-select w-full">
                      {WEEKDAY_LABELS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{describeBackupSchedule(backupFrequency, backupTime, backupWeekday)}</p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <SectionTitle icon={<ListChecks className="w-4 h-4" />} title="Admin permissions" hint="What the store Admin may do. Only the Developer can change these later." />
              {PERMISSION_GROUPS.map(group => (
                <div key={group.title} className="p-3 bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 rounded-xl">
                  <span className="font-bold text-teal-600 dark:text-teal-400 text-xs block mb-2">{group.title}</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {group.items.map(item => (
                      <label key={item.key} onClick={() => togglePermission(item.key)} className="flex items-center space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5">
                        {adminPermissions[item.key] ? <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" /> : <Square className="w-4 h-4 text-slate-400 shrink-0" />}
                        <span className="text-slate-800 dark:text-slate-200 text-xs">{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className="p-3 bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
                <span className="font-bold text-teal-600 dark:text-teal-400 text-xs block mb-1">Admin policies</span>
                {ADMIN_POLICY_TOGGLES.map(toggle => (
                  <label key={toggle.key} onClick={() => setPolicies(prev => ({ ...prev, [toggle.key]: !prev[toggle.key] }))} className="flex items-start space-x-2 cursor-pointer p-1.5 rounded-lg hover:bg-teal-500/5">
                    {policies[toggle.key] ? <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" /> : <Square className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />}
                    <span className="text-xs">
                      <span className="text-slate-800 dark:text-slate-200 font-semibold block">{toggle.label}</span>
                      <span className="text-2xs text-slate-400">{toggle.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <SectionTitle icon={<CalendarClock className="w-4 h-4" />} title="License" hint="A demo locks Admin and Cashier sign-in when it ends. Only the Developer can extend it or switch to Full." />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['demo', 'full'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setLicenseMode(mode)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${licenseMode === mode ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'}`}
                  >
                    <div className="flex items-center space-x-2 text-sm font-bold text-slate-900 dark:text-white">
                      {mode === 'demo' ? <CalendarClock className="w-4 h-4 text-amber-500" /> : <BadgeCheck className="w-4 h-4 text-emerald-500" />}
                      <span>{mode === 'demo' ? 'Demo' : 'Full Version'}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {mode === 'demo' ? 'Works for a fixed number of days, then locks.' : 'No time limit.'}
                    </p>
                  </button>
                ))}
              </div>
              {licenseMode === 'demo' && (
                <div className="max-w-xs">
                  <label className={labelClass}>Demo length (days)</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={demoDays}
                    onChange={(e) => setDemoDays(Math.floor(Number(e.target.value)))}
                    className="field-select w-full"
                  />
                </div>
              )}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <SectionTitle icon={<CheckCircle2 className="w-4 h-4" />} title="Review and lock setup" hint="After this, the setup wizard can never run again on this installation." />
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
                {reviewRows.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 px-3 py-2 text-xs">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
                    <span className="text-slate-900 dark:text-white font-semibold text-right break-all">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step > 0 && (
            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={() => goTo(step - 1)}
                disabled={step === 1 || loading}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-all disabled:opacity-40 flex items-center space-x-1"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="flex-1 py-2.5 bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs rounded-xl shadow-lg flex items-center justify-center space-x-2 transition-all"
                >
                  <span>Next</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleComplete}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs rounded-xl shadow-lg flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{loading ? 'Saving & Locking Setup...' : 'Complete & Lock Setup'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; hint: string }> = ({ icon, title, hint }) => (
  <div>
    <div className="flex items-center space-x-2 text-sm font-bold text-slate-900 dark:text-white">
      <span className="text-teal-600 dark:text-teal-400">{icon}</span>
      <span>{title}</span>
    </div>
    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{hint}</p>
  </div>
);
