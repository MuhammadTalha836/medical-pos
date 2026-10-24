import React from 'react';
import { CashierShift, SystemSettings } from '../../types';
import { Printer, CheckCircle } from 'lucide-react';
import { normalizePaperSize } from '../../../shared/invoice';
import { formatDuration, moneyFormatter } from '../../utils/format';

interface ShiftThermalReceiptProps {
  shift: CashierShift;
  settings?: SystemSettings | null;
  onPrint?: () => void;
  onClose?: () => void;
}

export const ShiftThermalReceipt: React.FC<ShiftThermalReceiptProps> = ({
  shift,
  settings,
  onPrint,
  onClose
}) => {
  const storeName = settings?.store_name || 'PharmaCare Pro';
  const storeAddress = settings?.store_address || 'Suite #12-14, Health Plaza, Main Commercial Ave';
  const storePhone = settings?.store_phone || '+92 300 9876543 / 051-4567890';
  const drugLicenseNo = settings?.drug_license_no || 'DL-PHARM-2024-9981';
  const money = moneyFormatter(settings);
  const is58 = normalizePaperSize(settings?.invoice_paper_size ?? settings?.paper_width) === '58mm';

  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else {
      window.print();
    }
  };

  const startTimeStr = shift.start_time ? new Date(shift.start_time).toLocaleString() : 'N/A';
  const endTimeStr = shift.end_time ? new Date(shift.end_time).toLocaleString() : 'Ongoing';
  const durationStr = shift.duration_minutes
    ? formatDuration(shift.duration_minutes)
    : 'N/A';

  const opening = shift.opening_cash || 0;
  const cashSales = shift.total_cash_sales || 0;
  const cardSales = shift.total_card_sales || 0;
  const creditSales = shift.total_credit_sales || 0;
  const returns = shift.total_returns_amount || 0;
  const recoveries = shift.total_customer_payments || 0;
  const expected = shift.expected_cash ?? (opening + cashSales + recoveries - returns);
  const actual = shift.closing_cash ?? 0;
  const diff = shift.cash_difference ?? (actual - expected);

  return (
    <div className="flex flex-col items-center">
      {/* On-screen Preview Control Bar */}
      <div className="w-full flex justify-between items-center mb-4 no-print">
        <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
          <CheckCircle className="w-4 h-4 text-emerald-500" />
          <span>Shift Summary Receipt ({is58 ? '58mm' : '80mm'} Thermal)</span>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={handlePrint}
            className="btn-print flex items-center space-x-1"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Slip</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="btn-cancel text-xs"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Printable Receipt DOM */}
      <div
        id="thermal-receipt-printable"
        className={`bg-white text-black font-mono leading-tight border border-slate-300 shadow-xs select-text ${is58 ? 'print-paper-58mm w-[58mm] p-2 text-[10px]' : 'print-paper-80mm w-[80mm] p-4 text-[11px]'}`}
        style={{ fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace" }}
      >
        {/* Pharmacy Header */}
        <div className="text-center pb-2 border-b border-black">
          <div className="font-bold text-sm tracking-tight">{storeName}</div>
          <div className="text-[10px]">{storeAddress}</div>
          <div className="text-[10px]">Tel: {storePhone}</div>
          <div className="text-[10px]">Lic: {drugLicenseNo}</div>
          <div className="font-bold text-xs mt-2 uppercase tracking-wider py-1 border-y border-dashed border-black">
            CASHIER SHIFT RECONCILIATION
          </div>
        </div>

        {/* Shift Details */}
        <div className="py-2 border-b border-dashed border-black space-y-0.5 text-[10px]">
          <div className="flex justify-between">
            <span className="font-bold">Shift No:</span>
            <span className="font-bold">{shift.shift_no}</span>
          </div>
          <div className="flex justify-between">
            <span>Staff Member:</span>
            <span>{shift.user_name} (ID #{shift.user_id})</span>
          </div>
          <div className="flex justify-between">
            <span>Status:</span>
            <span className="font-bold uppercase">[{shift.status}]</span>
          </div>
          <div className="flex justify-between">
            <span>Shift Started:</span>
            <span>{startTimeStr}</span>
          </div>
          <div className="flex justify-between">
            <span>Shift Closed:</span>
            <span>{endTimeStr}</span>
          </div>
          <div className="flex justify-between font-bold pt-1 border-t border-dotted border-black">
            <span>Working Duration:</span>
            <span>{durationStr}</span>
          </div>
        </div>

        {/* Financial Drawer Breakdown */}
        <div className="py-2 border-b border-dashed border-black space-y-1">
          <div className="font-bold uppercase text-[10px]">Cash Drawer Accounting:</div>
          <div className="flex justify-between">
            <span>Opening Float:</span>
            <span>{money(opening)}</span>
          </div>
          <div className="flex justify-between">
            <span>(+) Cash Sales ({shift.total_sales_count} inv):</span>
            <span>{money(cashSales)}</span>
          </div>
          <div className="flex justify-between">
            <span>(+) Khata Recoveries:</span>
            <span>{money(recoveries)}</span>
          </div>
          <div className="flex justify-between text-rose-700">
            <span>(-) Cash Returns:</span>
            <span>-{money(returns)}</span>
          </div>
          <div className="flex justify-between font-bold pt-1 border-t border-black text-xs">
            <span>EXPECTED CASH:</span>
            <span>{money(expected)}</span>
          </div>
          <div className="flex justify-between font-bold text-xs">
            <span>ACTUAL COUNTED:</span>
            <span>{money(actual)}</span>
          </div>
          <div className="flex justify-between font-bold text-[11px] pt-1 border-t border-dotted border-black">
            <span>DRAWER VARIANCE:</span>
            <span>
              {diff === 0
                ? '0.00 (BALANCED)'
                : diff > 0
                ? `+${money(diff)} (OVER)`
                : `-${money(Math.abs(diff))} (SHORT)`}
            </span>
          </div>
        </div>

        {/* Non-Cash / Digital Sales Reference */}
        <div className="py-2 border-b border-dashed border-black space-y-0.5 text-[10px]">
          <div className="font-bold uppercase">Non-Drawer Transactions:</div>
          <div className="flex justify-between">
            <span>Card Transactions:</span>
            <span>{money(cardSales)}</span>
          </div>
          <div className="flex justify-between">
            <span>Credit Khata Sales:</span>
            <span>{money(creditSales)}</span>
          </div>
          <div className="flex justify-between font-bold pt-1 border-t border-dotted border-black">
            <span>TOTAL SHIFT REVENUE:</span>
            <span>{money((shift.total_sales_amount || 0))}</span>
          </div>
        </div>

        {/* Notes & Remarks */}
        {shift.notes && (
          <div className="py-2 border-b border-dashed border-black text-[10px]">
            <span className="font-bold">Remarks:</span>
            <div className="italic">{shift.notes}</div>
          </div>
        )}

        {/* Handover & Manager Signatures */}
        <div className="pt-6 pb-2 text-[10px] space-y-5">
          <div className="flex justify-between items-center">
            <span className="border-t border-black pt-1 w-28 text-center">Cashier Signature</span>
            <span className="border-t border-black pt-1 w-28 text-center">Manager Signature</span>
          </div>
          <div className="text-center text-[9px] text-slate-600">
            PharmaCare Pro • 100% Offline POS
          </div>
        </div>
      </div>
    </div>
  );
};
