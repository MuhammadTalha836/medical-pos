import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Calendar, Printer } from 'lucide-react';
import { api } from '../../services/apiService';
import { ControlledRegisterRow, SystemSettings } from '../../types';
import { printDocument } from '../../utils/printDocument';
import { localDateString } from '../../../shared/dates';

interface ControlledRegisterProps {
  settings?: SystemSettings | null;
  /** The loaded rows, for the page's CSV export */
  onData: (rows: ControlledRegisterRow[]) => void;
}

const firstOfMonth = () => `${localDateString().slice(0, 8)}01`;

const showDateTime = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : `${localDateString(d)} ${d.toTimeString().slice(0, 5)}`;
};

const showQty = (row: ControlledRegisterRow) => `${row.quantity} ${row.is_loose ? 'unit(s)' : 'pack(s)'}`;

/** Controlled-medicine register: every controlled sale with its patient, doctor and prescription */
export const ControlledRegister: React.FC<ControlledRegisterProps> = ({ settings, onData }) => {
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(localDateString);
  const [rows, setRows] = useState<ControlledRegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      setLoading(true);
      const data = await api.getControlledRegister({ date_from: dateFrom, date_to: dateTo });
      setRows(data);
      onData(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'The register could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const period = dateFrom || dateTo ? `${dateFrom || 'start'} to ${dateTo || 'today'}` : 'all dates';

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl flex flex-wrap items-center gap-3 text-xs shadow-xs">
        <span className="text-slate-600 dark:text-slate-400 font-semibold flex items-center gap-1">
          <Calendar className="w-4 h-4 text-teal-600 dark:text-teal-400" />
          <span>Date range:</span>
        </span>
        <input type="date" aria-label="From date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} className="field-input field-sm font-mono" />
        <span className="text-slate-400">to</span>
        <input type="date" aria-label="To date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} className="field-input field-sm font-mono" />
        <button type="button" onClick={load} className="btn-primary btn-sm">Apply Filter</button>
        <button type="button" onClick={() => printDocument(printRef.current, 'Controlled register')} disabled={rows.length === 0} className="btn-print btn-sm ml-auto">
          <Printer className="w-4 h-4" />
          <span>Print Register</span>
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={load} className="btn-secondary btn-sm">Try again</button>
        </div>
      )}

      <div ref={printRef} className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="px-4 pt-3">
          <h1 className="text-sm font-bold text-slate-900 dark:text-white">{settings?.store_name ? `${settings.store_name}: controlled-medicine register` : 'Controlled-medicine register'}</h1>
          <p className="text-2xs text-slate-500 dark:text-slate-400 muted">
            {period}, {rows.length} {rows.length === 1 ? 'entry' : 'entries'}{settings?.store_address ? `. ${settings.store_address}` : ''}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs mt-2">
            <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold border-y border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Invoice</th>
                <th className="py-2.5 px-3">Medicine</th>
                <th className="py-2.5 px-3 text-right num">Qty</th>
                <th className="py-2.5 px-3">Patient</th>
                <th className="py-2.5 px-3">CNIC</th>
                <th className="py-2.5 px-3">Doctor</th>
                <th className="py-2.5 px-3">Prescription</th>
                <th className="py-2.5 px-3">Sold by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {loading ? (
                <tr><td colSpan={9} className="py-12 text-center text-slate-500 dark:text-slate-400">Loading register…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    No controlled medicines were sold in this period. Mark a medicine as Controlled under Medicines → Schedule.
                  </td>
                </tr>
              ) : (
                rows.map(row => (
                  <tr key={row.id} className="align-top">
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap">{showDateTime(row.sale_date)}</td>
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap">{row.invoice_no}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{row.product_name}</td>
                    <td className="py-2.5 px-3 text-right font-mono num">
                      {showQty(row)}
                      {row.sale_status === 'cancelled'
                        ? <div className="text-2xs font-sans font-semibold text-rose-700 dark:text-rose-400">Invoice voided</div>
                        : row.returned_qty > 0 && <div className="text-2xs font-sans font-semibold text-amber-700 dark:text-amber-400">{row.returned_qty} returned</div>}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900 dark:text-white">{row.patient_name}</div>
                      {row.patient_phone && <div className="text-2xs font-mono text-slate-500 dark:text-slate-400 muted">{row.patient_phone}</div>}
                    </td>
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap">{row.patient_cnic || '-'}</td>
                    <td className="py-2.5 px-3">
                      <div>{row.doctor_name}</div>
                      {row.doctor_reg_no && <div className="text-2xs font-mono text-slate-500 dark:text-slate-400 muted">Reg. {row.doctor_reg_no}</div>}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-mono">{row.prescription_no}</div>
                      {row.notes && <div className="text-2xs text-slate-500 dark:text-slate-400 muted">{row.notes}</div>}
                    </td>
                    <td className="py-2.5 px-3">{row.user_name || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
