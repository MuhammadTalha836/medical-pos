import React, { useState } from 'react';
import { Cloud, CloudDownload, RefreshCw } from 'lucide-react';
import { api } from '../../services/apiService';
import { CloudBackupFile } from '../../types';

interface CloudBackupListProps {
  /** Google Drive account the backups live in */
  accountEmail: string | null;
  onRestored: (message: string) => void;
  onError: (message: string) => void;
}

// Online backups in the owner's Google Drive; loaded on request because it needs the internet
export const CloudBackupList: React.FC<CloudBackupListProps> = ({ accountEmail, onRestored, onError }) => {
  const [files, setFiles] = useState<CloudBackupFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setFiles(await api.getCloudBackups());
    } catch (err: any) {
      onError(`Online backups could not be loaded: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const restore = async (file: CloudBackupFile) => {
    const when = new Date(file.createdTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    if (!confirm(`CAUTION: Restoring will overwrite the current database with the online backup from ${when}.\n\nA safety copy of the current data is saved first.\n\nDo you want to proceed?`)) return;
    try {
      setRestoringId(file.id);
      const res = await api.restoreCloudBackup(file.id);
      onRestored(res.message);
    } catch (err: any) {
      onError(`Restore failed: ${err.message}`);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
          <Cloud className="w-4 h-4 text-sky-500" />
          Online Backups (Google Drive{accountEmail ? `: ${accountEmail}` : ''})
        </span>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary btn-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>{files ? 'Refresh' : 'Show online backups'}</span>
        </button>
      </div>

      {files && (
        <div className="table-container max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 font-bold text-2xs border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-2.5 px-3">Backup</th>
                <th className="py-2.5 px-3">Uploaded</th>
                <th className="py-2.5 px-3 text-right">Size</th>
                <th className="py-2.5 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {files.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400 dark:text-slate-500">
                    No online backups yet. The next backup is uploaded automatically.
                  </td>
                </tr>
              ) : files.map(file => (
                <tr key={file.id} className="hover:bg-teal-500/5 dark:hover:bg-teal-500/10">
                  <td className="py-2.5 px-3 font-mono text-slate-900 dark:text-white truncate max-w-[220px]" title={file.name}>{file.name}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                    {new Date(file.createdTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-300">{(file.size / 1024).toFixed(1)} KB</td>
                  <td className="py-2.5 px-3 text-center">
                    <button
                      type="button"
                      onClick={() => void restore(file)}
                      disabled={restoringId !== null}
                      className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/60 rounded-lg text-2xs font-semibold transition-colors inline-flex items-center space-x-1"
                    >
                      <CloudDownload className="w-4 h-4" />
                      <span>{restoringId === file.id ? 'Restoring…' : 'Restore'}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
