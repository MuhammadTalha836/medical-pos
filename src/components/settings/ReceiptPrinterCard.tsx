import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Printer, RefreshCw } from 'lucide-react';
import { PrinterInfo } from '../../types';
import { loadPrintPrefs, printReceipt, savePrintPrefs, type PrintPrefs } from '../../utils/printReceipt';

interface ReceiptPrinterCardProps {
  /** The receipt preview to print as a test */
  getTestReceipt: () => HTMLElement | null;
}

// Receipt printer for this computer: each counter keeps its own printer, so this is not a shared setting
export const ReceiptPrinterCard: React.FC<ReceiptPrinterCardProps> = ({ getTestReceipt }) => {
  const [prefs, setPrefs] = useState<PrintPrefs>(loadPrintPrefs);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const canPrintDirect = Boolean(window.electronAPI?.listPrinters);

  const loadPrinters = async () => {
    if (!window.electronAPI?.listPrinters) return;
    try {
      setLoading(true);
      setPrinters(await window.electronAPI.listPrinters());
    } catch {
      setMessage({ ok: false, text: 'Could not read the printers on this computer.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadPrinters(); }, []);

  const update = (next: Partial<PrintPrefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    savePrintPrefs(merged);
    setMessage(null);
  };

  const testPrint = async () => {
    setMessage(null);
    const result = await printReceipt(getTestReceipt(), prefs);
    if (!prefs.silent) return;
    setMessage(result.success
      ? { ok: true, text: 'Test receipt sent to the printer.' }
      : { ok: false, text: `The printer did not print: ${result.error}. The print window was opened instead.` });
  };

  // A saved printer that is no longer installed still shows, so the choice is visible
  const savedMissing = prefs.printerName && !printers.some(p => p.name === prefs.printerName);

  return (
    <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs">
      <div className="flex items-center space-x-2">
        <Printer className="w-5 h-5 text-teal-600 dark:text-teal-400" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Receipt Printer (this computer)</h3>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Choose the printer at this counter. These choices are saved on this computer only and apply as soon as you change them.
      </p>

      {message && (
        <div className={`p-3 rounded-xl flex items-center gap-2 text-sm font-semibold border ${message.ok
          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
          : 'bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-400'}`}>
          {message.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {!canPrintDirect ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">Printer selection is available in the installed desktop app.</p>
      ) : (
        <>
          <label className="block">
            <span className="field-label">Printer</span>
            <div className="flex gap-2">
              <select
                value={prefs.printerName}
                onChange={e => update({ printerName: e.target.value })}
                className="field-select w-full"
              >
                <option value="">System default printer</option>
                {savedMissing && <option value={prefs.printerName}>{prefs.printerName} (not found)</option>}
                {printers.map(p => <option key={p.name} value={p.name}>{p.displayName}</option>)}
              </select>
              <button type="button" onClick={() => void loadPrinters()} disabled={loading} className="btn-secondary shrink-0" title="Refresh printer list">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.silent}
              onChange={e => update({ silent: e.target.checked })}
              className="w-5 h-5 mt-0.5 accent-teal-600 cursor-pointer"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">Print without dialog</span>
              <span className="field-hint">Receipts go straight to the printer above. Turn it off to choose the printer each time.</span>
            </span>
          </label>

          <div className="flex justify-end">
            <button type="button" onClick={() => void testPrint()} className="btn-print">
              <Printer className="w-4 h-4" />
              <span>Print Test Receipt</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};
