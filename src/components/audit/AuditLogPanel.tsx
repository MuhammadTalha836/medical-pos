import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Filter, Search } from 'lucide-react';
import { AuditLogEntry, AuditLogPage, AuditLogQuery } from '../../types';

interface AuditLogPanelProps {
  /** Loads one page (the Developer's full log, or the Admin's view without the Developer's own rows) */
  load: (params: AuditLogQuery) => Promise<AuditLogPage>;
  /** Told the number of matching rows after every load (the Developer page shows it on its tab) */
  onTotal?: (total: number) => void;
}

/** The security audit trail: filters, a read-only table and paging */
export const AuditLogPanel: React.FC<AuditLogPanelProps> = ({ load, onTotal }) => {
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterModule, setFilterModule] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterUser, setFilterUser] = useState('');

  const fetchPage = async (page = 1) => {
    setAuditLoading(true);
    setError(null);
    try {
      const res = await load({
        page,
        limit: 20,
        module: filterModule || undefined,
        status: filterStatus || undefined,
        user: filterUser || undefined
      });
      setAuditLogs(res.logs);
      setTotal(res.total);
      setAuditPage(res.page);
      setTotalPages(res.totalPages);
      onTotal?.(res.total);
    } catch (err: any) {
      setError(err?.message || 'The audit log could not be loaded.');
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    void fetchPage(1);
  }, [filterModule, filterStatus]);

  return (
      <div className="space-y-4">
      {error && (
        <p className="p-3 rounded-xl bg-rose-500/10 text-sm font-semibold text-rose-700 dark:text-rose-400" role="alert">{error}</p>
      )}
        {/* Audit Filters Bar */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <div className="flex items-center space-x-1 text-xs text-slate-500">
              <Filter className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>Filters:</span>
            </div>

            <select
              value={filterModule}
              onChange={(e) => setFilterModule(e.target.value)}
              className="field-select field-sm"
            >
              <option value="">All Modules</option>
              <option value="AUTH">AUTH</option>
              <option value="USERS">USERS</option>
              <option value="SETTINGS">SETTINGS</option>
              <option value="DEVELOPER_SETTINGS">DEVELOPER_SETTINGS</option>
              <option value="Inventory">Inventory</option>
              <option value="Shifts">Shifts</option>
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="field-select field-sm"
            >
              <option value="">All Statuses</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
              <option value="DENIED">DENIED</option>
            </select>

            <div className="relative">
              <input
                type="text"
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchPage(1)}
                placeholder="Filter by user..."
                className="field-input field-sm w-36"
              />
            </div>

            <button
              onClick={() => fetchPage(1)}
              className="btn-primary btn-sm"
            >
              <Search className="w-4 h-4" />
              <span>Filter</span>
            </button>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 self-end md:self-center">
            Total Records: <span className="font-mono font-bold text-slate-900 dark:text-white">{total}</span>
          </div>
        </div>

        {/* Audit Logs Table */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-surface-inset-dark/50 text-slate-500 dark:text-slate-400 text-2xs">
                  <th className="py-3 px-3">Timestamp</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Action</th>
                  <th className="py-3 px-3">Module</th>
                  <th className="py-3 px-3">Acting User</th>
                  <th className="py-3 px-3">Affected Account</th>
                  <th className="py-3 px-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono">
                {auditLoading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400 font-sans">
                      Loading security audit trail...
                    </td>
                  </tr>
                ) : auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400 font-sans">
                      No audit events recorded matching current criteria.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map(log => (
                    <tr key={log.id} className="align-top hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                      <td className="py-2.5 px-3 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-2xs font-bold ${
                          log.status === 'SUCCESS'
                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                            : log.status === 'DENIED'
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                        }`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-bold text-slate-900 dark:text-white">
                        {log.action}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-teal-700 dark:text-teal-400">
                        {log.module}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {log.user_name || 'System'}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                        {log.affected_user || '-'}
                      </td>
                      {/* The full message, wrapped over as many lines as it needs (it used to be cut off with "...") */}
                      <td className="py-2.5 px-3 text-xs text-slate-600 dark:text-slate-300 min-w-72 whitespace-pre-wrap wrap-anywhere leading-relaxed">
                        {log.details || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-500">
                Page <span className="font-bold text-slate-900 dark:text-white">{auditPage}</span> of {totalPages}
              </span>

              <div className="flex items-center space-x-1">
                <button
                  disabled={auditPage <= 1 || auditLoading}
                  onClick={() => fetchPage(auditPage - 1)}
                  className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  disabled={auditPage >= totalPages || auditLoading}
                  onClick={() => fetchPage(auditPage + 1)}
                  className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
  );
};
