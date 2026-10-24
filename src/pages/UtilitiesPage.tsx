import React, { useState, useEffect } from 'react';
import { api } from '../services/apiService';
import { useAuthStore } from '../store/useAuthStore';
import { BackupStatus, SystemSettings } from '../types';
import { BACKUP_FREQUENCY_LABELS, describeBackupSchedule } from '../utils/backup';
import { ShiftHistoryHub } from '../components/shifts/ShiftHistoryHub';
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Sparkles,
  Clock,
  ShieldCheck,
  FolderOpen,
  HardDrive,
  Copy,
  Check,
  BookOpen,
  CheckCircle,
  FileCode,
  Sliders,
  Save
} from 'lucide-react';

interface UtilitiesPageProps {
  settings?: SystemSettings | null;
  onRefreshSettings?: () => void;
}

export const UtilitiesPage: React.FC<UtilitiesPageProps> = ({ settings, onRefreshSettings }) => {
  const { user } = useAuthStore();
  const [activeSubTab, setActiveSubTab] = useState<'shifts' | 'backups' | 'guide'>('shifts');

  // Backups state
  const [backups, setBackups] = useState<any>({ records: [], diskFiles: [] });
  const [loading, setLoading] = useState(false);
  const [customBackupDir, setCustomBackupDir] = useState('./backups');
  const [secondaryBackupDir, setSecondaryBackupDir] = useState('');
  const [savedBackupDirs, setSavedBackupDirs] = useState({ primary: './backups', secondary: '' });
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [backupTime, setBackupTime] = useState('23:00');
  const [savingSettings, setSavingSettings] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Stock Zero utility state
  const [stockZeroCompanyId, setStockZeroCompanyId] = useState('');
  const [stockZeroConfirmText, setStockZeroConfirmText] = useState('');
  const [companies, setCompanies] = useState<any[]>([]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [bkList, compList, allSettings, status] = await Promise.all([
        api.getBackupList().catch(() => ({ records: [], diskFiles: [] })),
        api.getCompanies(),
        api.getSettings(),
        api.getBackupStatus().catch(() => null)
      ]);
      setBackups(bkList);
      setCompanies(compList);
      setBackupStatus(status);
      if (status) setBackupTime(status.scheduled_time);

      if (allSettings) {
        const primary = allSettings.auto_backup_dir || './backups';
        const secondary = allSettings.secondary_backup_dir || '';
        setCustomBackupDir(primary);
        setSecondaryBackupDir(secondary);
        setSavedBackupDirs({ primary, secondary });
      }
    } catch (err) {
      console.error('Failed to load utilities data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelectPrimaryFolder = async () => {
    if (window.electronAPI?.selectBackupDir) {
      const selected = await window.electronAPI.selectBackupDir();
      if (selected) {
        setCustomBackupDir(selected);
      }
    } else {
      alert('Directory selector is supported natively in the desktop Electron app. In browser mode, please enter the folder path directly.');
    }
  };

  const handleSelectSecondaryFolder = async () => {
    if (window.electronAPI?.selectBackupDir) {
      const selected = await window.electronAPI.selectBackupDir();
      if (selected) {
        setSecondaryBackupDir(selected);
      }
    } else {
      alert('Directory selector is supported natively in the desktop Electron app. In browser mode, please enter the folder path directly.');
    }
  };

  const saveBackupFolders = async () => {
    const primary = customBackupDir.trim() || './backups';
    const secondary = secondaryBackupDir.trim();
    if (primary === savedBackupDirs.primary && secondary === savedBackupDirs.secondary) return;
    await api.saveSettings({ auto_backup_dir: primary, secondary_backup_dir: secondary });
    setSavedBackupDirs({ primary, secondary });
  };

  const handleSaveBackupSettings = async () => {
    try {
      setSavingSettings(true);
      setMessage(null);
      await saveBackupFolders();
      if (backupStatus && backupTime !== backupStatus.scheduled_time) {
        await api.updateBackupTime(backupTime);
      }
      setMessage({ type: 'success', text: 'Backup folders and time of day saved successfully.' });
      if (onRefreshSettings) onRefreshSettings();
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to save settings: ' + err.message });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setLoading(true);
      setMessage(null);
      // Backups always use the saved folders, so persist any edited paths first
      await saveBackupFolders();
      const res = await api.createBackup();
      if (res.success) {
        setMessage({
          type: 'success',
          text: `Backup created: ${res.filename} (${(res.sizeBytes / 1024).toFixed(1)} KB). Integrity check and SHA-256 verified.${res.secondaryPath ? ' Synced to secondary drive.' : ''}${res.prunedCount ? ` ${res.prunedCount} old backup(s) removed by the retention limit.` : ''}`
        });
        loadData();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Backup failed: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreFromPicker = async () => {
    if (window.electronAPI?.selectRestoreFile) {
      const selectedFile = await window.electronAPI.selectRestoreFile();
      if (selectedFile) {
        const baseName = selectedFile.split(/[/\\]/).pop() || selectedFile;
        handleRestoreBackup(selectedFile, baseName);
      }
    } else {
      const filePath = prompt('Enter the absolute path to the .db backup file you want to restore:');
      if (filePath) {
        const baseName = filePath.split(/[/\\]/).pop() || filePath;
        handleRestoreBackup(filePath, baseName);
      }
    }
  };

  const handleRestoreBackup = async (filepath: string, filename: string) => {
    if (!confirm(`CAUTION: Restoring will overwrite the current database with "${filename}".\n\nAn automatic safety snapshot (pre_restore) will be taken immediately before restoring.\n\nDo you want to proceed?`)) {
      return;
    }

    try {
      setLoading(true);
      setMessage(null);
      const res = await api.restoreBackup(filepath);
      if (res.success) {
        setMessage({ type: 'success', text: res.message });
        loadData();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Restore failed: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleOptimizeDatabase = async () => {
    try {
      setLoading(true);
      setMessage(null);
      const res = await api.optimizeDatabase();
      if (res.success) {
        setMessage({
          type: 'success',
          text: `${res.message} File size: ${(res.sizeBefore / 1024).toFixed(1)} KB -> ${(res.sizeAfter / 1024).toFixed(1)} KB.`
        });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Optimization failed: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteStockZero = async () => {
    if (stockZeroConfirmText !== 'RESET-ZERO-CONFIRM') {
      alert('Please enter the exact confirmation code: RESET-ZERO-CONFIRM');
      return;
    }

    try {
      setLoading(true);
      setMessage(null);
      const res = await api.resetStockZero({
        company_id: stockZeroCompanyId ? Number(stockZeroCompanyId) : undefined,
        confirmation_code: stockZeroConfirmText,
        user_id: user?.id,
        user_name: user?.full_name
      });
      if (res.success) {
        setStockZeroConfirmText('');
        setMessage({ type: 'success', text: res.message });
        loadData();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Stock zero reset failed: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const copyChecksum = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2500);
  };

  return (
    <div className="page-container">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-500/10 dark:bg-teal-500/20 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                Shifts, Backups & Disaster Recovery
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Cashier register closing, multi-destination SQLite snapshots, SHA-256 verification, and hardware failure guides
              </p>
            </div>
          </div>
        </div>

        {/* Sub-Tab Navigation */}
        <div className="flex items-center space-x-1 p-1 bg-slate-200/80 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs font-semibold">
          <button
            onClick={() => setActiveSubTab('shifts')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg transition-all ${
              activeSubTab === 'shifts'
                ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Cashier Shifts</span>
          </button>

          <button
            onClick={() => setActiveSubTab('backups')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg transition-all ${
              activeSubTab === 'backups'
                ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Backup & Vault</span>
          </button>

          <button
            onClick={() => setActiveSubTab('guide')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg transition-all ${
              activeSubTab === 'guide'
                ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Emergency Recovery Guide</span>
          </button>
        </div>
      </div>

      {message && (
        <div className={`flex items-center space-x-2.5 px-4 py-3 rounded-xl text-xs font-medium border animate-in fade-in ${
          message.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
            : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Sub-Tab 1: Cashier Shifts & Register Closing Hub */}
      {activeSubTab === 'shifts' && (
        <ShiftHistoryHub settings={settings} />
      )}

      {/* Sub-Tab 2: Database Backups, Multi-Destination Sync & Maintenance */}
      {activeSubTab === 'backups' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Card 1: Backup Hub & Multi-Destination Vault */}
            <div className="lg:col-span-2 card-premium p-5 space-y-5 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-8 h-8 rounded-lg bg-teal-500/10 dark:bg-teal-500/20 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold">
                      <HardDrive className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                        Multi-Destination SQLite Vault & Instant Backup
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Zero-downtime atomic database snapshot with SHA-256 integrity verification
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleRestoreFromPicker}
                    disabled={loading}
                    className="btn-secondary px-3 py-1.5 text-xs flex items-center space-x-1.5"
                    title="Select any .db file from your disk or external USB to restore"
                  >
                    <Upload className="w-3.5 h-3.5 text-amber-500" />
                    <span>Restore from File...</span>
                  </button>
                </div>

                {/* Primary & Secondary Path Config */}
                <div className="card-surface p-4 space-y-4">
                  {/* Primary Location */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Primary Backup Folder (Local SSD / High-Speed)
                    </label>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={customBackupDir}
                        onChange={(e) => setCustomBackupDir(e.target.value)}
                        placeholder="./backups"
                        className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500"
                      />
                      <button
                        type="button"
                        onClick={handleSelectPrimaryFolder}
                        className="btn-secondary px-3 py-2 text-xs flex items-center space-x-1"
                        title="Browse local folder"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
                        <span>Browse...</span>
                      </button>
                    </div>
                  </div>

                  {/* Secondary Destination (USB / External Drive) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Secondary External Destination (USB Drive / Network Share)
                      </label>
                      <span className="text-[10px] text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wider">
                        Recommended for Disaster Recovery
                      </span>
                    </div>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={secondaryBackupDir}
                        onChange={(e) => setSecondaryBackupDir(e.target.value)}
                        placeholder="e.g. E:\PharmacyBackups or /media/usb/backups"
                        className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500"
                      />
                      <button
                        type="button"
                        onClick={handleSelectSecondaryFolder}
                        className="btn-secondary px-3 py-2 text-xs flex items-center space-x-1"
                        title="Browse external USB drive or network folder"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
                        <span>Browse...</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Every backup created will automatically save a duplicate copy and its SHA-256 sidecar file here.
                    </p>
                  </div>

                  {/* Automatic Backup Schedule: frequency is Developer-controlled, Admin sets the time of day */}
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                    <div className="text-xs text-slate-700 dark:text-slate-300">
                      <span className="text-slate-500 dark:text-slate-400">Frequency: </span>
                      <strong>{backupStatus ? BACKUP_FREQUENCY_LABELS[backupStatus.frequency] : '...'}</strong>
                      <span className="flex items-center text-[10px] text-slate-400 mt-0.5">
                        <Lock className="w-3 h-3 mr-0.5" /> Set by Developer
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-xs text-slate-500 dark:text-slate-400">Time of day:</span>
                      <input
                        type="time"
                        value={backupTime}
                        onChange={(e) => setBackupTime(e.target.value)}
                        disabled={!backupStatus || backupStatus.frequency === 'off'}
                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleSaveBackupSettings}
                        disabled={savingSettings}
                        className="btn-secondary px-3 py-1.5 text-xs flex items-center space-x-1.5"
                      >
                        <Save className="w-3.5 h-3.5 text-teal-500" />
                        <span>{savingSettings ? 'Saving...' : 'Save Settings'}</span>
                      </button>
                    </div>

                    {backupStatus && (
                      <div className="sm:col-span-3 text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
                        <span>{describeBackupSchedule(backupStatus.frequency, backupStatus.scheduled_time, backupStatus.weekly_day)}</span>
                        {backupStatus.next_run_at && (
                          <span>Next run: <strong className="text-slate-700 dark:text-slate-300">{new Date(backupStatus.next_run_at).toLocaleString()}</strong></span>
                        )}
                        <span>Keeping newest <strong className="text-slate-700 dark:text-slate-300">{backupStatus.retention_limit}</strong> verified backups ({backupStatus.retained_count} stored)</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Instant Backup Trigger Row */}
                <div className="flex items-center justify-between pt-1">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center space-x-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Database: <strong className="text-slate-800 dark:text-slate-200 font-mono">data/pharmacy.db</strong> (WAL Mode Active)</span>
                  </div>

                  <button
                    onClick={handleCreateBackup}
                    disabled={loading}
                    className="btn-primary px-5 py-2.5 text-xs flex items-center space-x-2 shadow-xs"
                  >
                    <Download className="w-4 h-4" />
                    <span>Create Snapshot Now</span>
                  </button>
                </div>
              </div>

              {/* Backup History Table */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Available Backups & Integrity Hashes
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Showing latest snapshots on disk
                  </span>
                </div>

                <div className="table-container max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800/90 backdrop-blur-xs text-slate-700 dark:text-slate-300 font-bold text-[10px] uppercase border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="py-2.5 px-3">Filename</th>
                        <th className="py-2.5 px-3">Type</th>
                        <th className="py-2.5 px-3 text-right">Size</th>
                        <th className="py-2.5 px-3">SHA-256 Checksum</th>
                        <th className="py-2.5 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                      {backups.diskFiles?.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-400 dark:text-slate-500">
                            No backup files found yet. Click "Create Snapshot Now" above to create the initial snapshot.
                          </td>
                        </tr>
                      ) : (
                        backups.diskFiles?.map((file: any, idx: number) => {
                          const record = backups.records?.find((r: any) => r.backup_filename === file.filename);
                          const kind = file.filename.includes('_pre_restore_')
                            ? { label: 'Pre-Restore', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' }
                            : file.filename.includes('_shift_close_')
                            ? { label: 'Shift Close', cls: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' }
                            : file.filename.includes('_scheduled_') || file.filename.includes('_auto_')
                            ? { label: 'Scheduled', cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' }
                            : { label: 'Manual', cls: 'bg-teal-500/10 text-teal-600 dark:text-teal-400' };
                          return (
                          <tr key={idx} className="hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors">
                            <td className="py-2.5 px-3 font-mono text-slate-900 dark:text-white text-[11px] truncate max-w-[190px]" title={file.path}>
                              {file.filename}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 text-[10px]">
                              <div className="flex flex-col items-start gap-1">
                                <span className={`px-2 py-0.5 rounded-full font-semibold ${kind.cls}`}>{kind.label}</span>
                                {record?.verified === 1 && record?.status === 'success' ? (
                                  <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400 font-semibold">
                                    <ShieldCheck className="w-3 h-3 mr-0.5" /> Verified
                                  </span>
                                ) : !record ? (
                                  <span className="text-slate-400">Untracked</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-300 text-[11px]">
                              {(file.sizeBytes / 1024).toFixed(1)} KB
                            </td>
                            <td className="py-2.5 px-3 text-[11px] font-mono">
                              {file.checksum ? (
                                <div className="flex items-center space-x-1.5">
                                  <span className="text-slate-500 dark:text-slate-400 truncate max-w-[120px]" title={file.checksum}>
                                    {file.checksum.slice(0, 10)}...{file.checksum.slice(-6)}
                                  </span>
                                  <button
                                    onClick={() => copyChecksum(file.checksum)}
                                    className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-sm transition-colors text-slate-500 hover:text-teal-600"
                                    title="Copy SHA-256 Checksum"
                                  >
                                    {copiedHash === file.checksum ? (
                                      <Check className="w-3 h-3 text-emerald-500" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-slate-400 text-[10px]">Legacy</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <button
                                onClick={() => handleRestoreBackup(file.path, file.filename)}
                                disabled={loading}
                                className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/60 rounded-lg text-[10px] font-semibold transition-colors inline-flex items-center space-x-1"
                              >
                                <Upload className="w-3 h-3" />
                                <span>Restore</span>
                              </button>
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right Column: Database Optimization & Diagnostic Health */}
            <div className="space-y-6">
              {/* Card 2: Database Optimization */}
              <div className="card-premium p-5 space-y-4">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-lg bg-teal-500/10 dark:bg-teal-500/20 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Database Health & VACUUM</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Defragment tables and rebuild B-Trees</p>
                  </div>
                </div>

                <div className="card-surface p-4 space-y-3">
                  <div className="text-xs text-slate-600 dark:text-slate-300 space-y-2">
                    <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-800">
                      <span>Engine:</span>
                      <span className="font-mono text-teal-600 dark:text-teal-400 font-bold">better-sqlite3 v11</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-800">
                      <span>Journal Mode:</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200 font-semibold">WAL (Write-Ahead)</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-800">
                      <span>Referential Integrity:</span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">ENFORCED</span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span>Busy Timeout:</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">5000 ms</span>
                    </div>
                  </div>

                  <button
                    onClick={handleOptimizeDatabase}
                    disabled={loading}
                    className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-teal-700 dark:text-teal-300 font-bold text-xs rounded-xl border border-slate-300 dark:border-slate-700 transition-colors flex items-center justify-center space-x-2 shadow-xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    <span>Run VACUUM & Optimize</span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Recommended monthly to reclaim deleted invoice space and update query optimizer statistics.
                </p>
              </div>

              {/* Card 3: Stock Zero Audit Reset */}
              <div className="card-premium p-5 space-y-4 border-rose-200 dark:border-rose-900/40">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Stock Zero Audit Reset</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Physical stock count audit tool</p>
                  </div>
                </div>

                <div className="bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/60 p-4 rounded-xl space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Target Company</label>
                    <select
                      value={stockZeroCompanyId}
                      onChange={(e) => setStockZeroCompanyId(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-rose-500"
                    >
                      <option value="">ALL PRODUCTS (Entire Inventory)</option>
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-rose-700 dark:text-rose-400 mb-1">
                      Type Code: <strong className="font-mono text-slate-900 dark:text-white select-all">RESET-ZERO-CONFIRM</strong>
                    </label>
                    <input
                      type="text"
                      value={stockZeroConfirmText}
                      onChange={(e) => setStockZeroConfirmText(e.target.value)}
                      placeholder="RESET-ZERO-CONFIRM"
                      className="w-full bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-800 rounded-xl px-3 py-2 text-xs font-mono text-rose-800 dark:text-rose-300 focus:outline-hidden focus:ring-1 focus:ring-rose-500"
                    />
                  </div>

                  <button
                    onClick={handleExecuteStockZero}
                    disabled={stockZeroConfirmText !== 'RESET-ZERO-CONFIRM' || loading}
                    className="w-full btn-danger py-2 text-xs flex items-center justify-center space-x-1.5"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Execute Stock Zero Reset</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 3: In-App Interactive Emergency Disaster Recovery Guide */}
      {activeSubTab === 'guide' && (
        <div className="space-y-6">
          <div className="card-premium p-6 space-y-6">
            <div className="flex items-center space-x-3 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="w-10 h-10 rounded-xl bg-teal-500/10 dark:bg-teal-500/20 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  PharmaCare Pro - Emergency Disaster Recovery & Reinstallation Manual
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Standard Operating Procedures (SOP) for hardware failure, machine replacement, and database recovery
                </p>
              </div>
            </div>

            {/* Step-by-Step Recovery Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Card 1 */}
              <div className="card-surface p-4 space-y-2 border-l-4 border-teal-500">
                <div className="flex items-center space-x-2">
                  <span className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs font-bold">1</span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Hardware Replacement</h3>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  In case of total POS hardware failure (burned motherboard or drive crash), set up any replacement PC (Windows 10/11 or Linux). Install Node.js v18+ LTS, clone or extract the PharmaCare Pro folder, and run <code className="bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded-sm font-mono text-teal-600 dark:text-teal-400">npm install</code>.
                </p>
              </div>

              {/* Card 2 */}
              <div className="card-surface p-4 space-y-2 border-l-4 border-teal-500">
                <div className="flex items-center space-x-2">
                  <span className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs font-bold">2</span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Locate External Backup USB</h3>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Plug in the secondary backup USB flash drive configured on the previous machine. Navigate to the vault folder (e.g. <code className="bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded-sm font-mono">E:\PharmacyBackups</code>) and locate the latest <code className="font-mono">.db</code> file and its matching <code className="font-mono">.sha256</code> hash file.
                </p>
              </div>

              {/* Card 3 */}
              <div className="card-surface p-4 space-y-2 border-l-4 border-teal-500">
                <div className="flex items-center space-x-2">
                  <span className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs font-bold">3</span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Verify SHA-256 Checksum (Offline)</h3>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Confirm the backup has not suffered bit rot or corruption before restoring:
                </p>
                <div className="bg-slate-900 text-slate-200 p-2.5 rounded-lg font-mono text-[11px] space-y-1">
                  <div className="text-slate-400"># Windows PowerShell:</div>
                  <div className="text-teal-400">Get-FileHash -Algorithm SHA256 .\pharmacy_backup_xxx.db</div>
                  <div className="text-slate-400 pt-1"># Linux / macOS:</div>
                  <div className="text-teal-400">sha256sum -c pharmacy_backup_xxx.db.sha256</div>
                </div>
              </div>

              {/* Card 4 */}
              <div className="card-surface p-4 space-y-2 border-l-4 border-teal-500">
                <div className="flex items-center space-x-2">
                  <span className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs font-bold">4</span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Restore & Resume Operations</h3>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Start PharmaCare Pro, open this <strong>Backup & Recovery</strong> tab, click <strong>"Restore from File..."</strong>, and select the verified backup. Alternatively, copy the backup file directly into <code className="bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded-sm font-mono">./data/pharmacy.db</code> while the app is stopped.
                </p>
              </div>
            </div>

            {/* Offline Integrity Check Details */}
            <div className="card-surface p-5 space-y-3">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>Automatic Pre-Restore Safety Net</span>
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                PharmaCare Pro automatically generates a safety rollback snapshot (<code className="font-mono text-teal-600 dark:text-teal-400">pharmacy_backup_pre_restore_[timestamp].db</code>) before replacing the database. If a user accidentally restores an older backup file, they can immediately undo the operation by restoring the pre-restore snapshot.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
