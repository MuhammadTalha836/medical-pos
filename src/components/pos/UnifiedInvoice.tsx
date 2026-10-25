import React, { useRef } from 'react';
import { SaleInvoice, SaleItem, SystemSettings, InvoiceTemplateType, InvoicePaperSize } from '../../types';
import { Printer, Receipt } from 'lucide-react';
import {
  TEMPLATE_LABELS,
  normalizePaperSize,
  normalizeTemplate
} from '../../../shared/invoice';
import { moneyFormatter } from '../../utils/format';
import { composeInvoiceFooter } from '../../../shared/developerProfile';
import { printReceipt } from '../../utils/printReceipt';

interface UnifiedInvoiceProps {
  invoice: SaleInvoice;
  settings?: Partial<SystemSettings> | null;
  templateOverride?: InvoiceTemplateType;
  paperSizeOverride?: InvoicePaperSize;
  onPrint?: () => void;
  onClose?: () => void;
  showControls?: boolean;
  /** More buttons in the on-screen control bar (never printed), e.g. WhatsApp */
  extraActions?: React.ReactNode;
}

export const UnifiedInvoice: React.FC<UnifiedInvoiceProps> = ({
  invoice,
  settings,
  templateOverride,
  paperSizeOverride,
  onPrint,
  onClose,
  showControls = true,
  extraActions
}) => {
  // Thermal-only: the admin-selected design and roll width are authoritative (legacy values normalize safely)
  const template = normalizeTemplate(templateOverride ?? settings?.default_invoice_template);
  const paperSize = normalizePaperSize(paperSizeOverride ?? settings?.invoice_paper_size ?? settings?.paper_width);
  const is58 = paperSize === '58mm';

  // Protected identity & developer footer: prefer the snapshot captured at sale time so reprints match the original
  const storeName = invoice.store_name_snapshot || settings?.store_name || 'PharmaCare Pro';
  const storeAddress = invoice.store_address_snapshot || settings?.store_address || '';
  const developerFooter = invoice.invoice_footer_snapshot || composeInvoiceFooter(settings);

  // Settings & Values (empty details are left off the receipt, never filled with sample text)
  const storePhone = settings?.store_phone || '';
  const licenseLine = [
    settings?.drug_license_no && `DRUG LIC: ${settings.drug_license_no}`,
    settings?.tax_no
  ].filter(Boolean).join(' | ');
  const headerNote = settings?.receipt_header || '';
  const footerNote = settings?.receipt_footer || 'Thank you for your visit!';
  const terms = settings?.receipt_terms || '1. Returns accepted within 3 days with original invoice.\n2. Refrigerated cold-chain medicines & loose items are non-returnable.';
  const returnPolicy = settings?.return_policy_text || 'Unopened medicines in original packaging may be returned or exchanged within 3 days with this invoice. Heat-sensitive and loose units are non-returnable.';
  const money = moneyFormatter(settings);

  // Helper for field visibility (default is true unless strictly 'false')
  const isVisible = (key: string) => settings?.[key] !== 'false';

  // Font scale steps down one size on the narrower 58mm roll
  const fs = is58
    ? { base: 'text-[10px]', sm: 'text-[9px]', xs: 'text-[8px]', title: 'text-[13px]', net: 'text-[12px]' }
    : { base: 'text-[11px]', sm: 'text-[10px]', xs: 'text-[9px]', title: 'text-[15px]', net: 'text-[13px]' };

  const receiptRef = useRef<HTMLDivElement>(null);
  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else {
      void printReceipt(receiptRef.current);
    }
  };

  // Pre-calculated values
  const items = invoice.items || [];
  const totalItemsCount = items.length;
  const totalUnitsCount = items.reduce((acc, it) => acc + (it.quantity || 0), 0);
  const totalDiscount = (invoice.total_item_discount || 0) + (invoice.bill_discount_amt || 0);
  const saleDate = new Date(invoice.sale_date);
  const dateText = `${saleDate.toLocaleDateString()} ${saleDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  // ============================================================
  // Shared receipt sections
  // ============================================================
  const header = (
    <div className="text-center pb-2 border-b border-dashed border-black">
      {isVisible('show_store_name') && (
        <div className={`font-extrabold ${fs.title} tracking-wide uppercase`}>{storeName}</div>
      )}
      {isVisible('show_store_address') && storeAddress && (
        <div className={`${fs.sm} mt-0.5`}>{storeAddress}</div>
      )}
      {isVisible('show_store_phone') && storePhone && (
        <div className={fs.sm}>Tel: {storePhone}</div>
      )}
      {template !== 'compact' && isVisible('show_store_license') && licenseLine && (
        <div className={`${fs.xs} mt-1 font-bold`}>{licenseLine}</div>
      )}
      {template !== 'compact' && headerNote && <div className={`${fs.xs} italic mt-0.5`}>{headerNote}</div>}
    </div>
  );

  const invoiceMeta = (
    <div className={`py-2 ${fs.sm} border-b border-dashed border-black space-y-0.5`}>
      <div className="flex justify-between gap-2 font-bold">
        {isVisible('show_invoice_no') && <span>INV: {invoice.invoice_no}</span>}
        <span>{invoice.payment_type.toUpperCase()}</span>
      </div>
      <div className={`flex flex-wrap justify-between gap-x-2 ${fs.xs} text-gray-700`}>
        {isVisible('show_invoice_date') && <span>{dateText}</span>}
        {isVisible('show_cashier_name') && <span>Cashier: {invoice.user_name || 'Staff'}</span>}
      </div>
      {isVisible('show_customer_name') && invoice.customer_name && (
        <div className={fs.xs}>
          Customer: {invoice.customer_name}
          {isVisible('show_customer_phone') && invoice.customer_phone ? ` (${invoice.customer_phone})` : ''}
        </div>
      )}
    </div>
  );

  // Column table: only used for Classic on the 80mm roll where there is room for every column
  const itemsTable = (
    <div className="py-2 border-b border-dashed border-black">
      <table className={`w-full ${fs.xs}`}>
        <thead>
          <tr className="border-b border-black text-left">
            {isVisible('show_col_product_name') && <th className="py-0.5 font-bold">ITEM</th>}
            {isVisible('show_col_p_code') && <th className="py-0.5 font-bold">CODE</th>}
            {isVisible('show_col_unit') && <th className="py-0.5 font-bold text-center">QTY</th>}
            {isVisible('show_col_unit_price') && <th className="py-0.5 font-bold text-right">RATE</th>}
            {isVisible('show_col_discount') && <th className="py-0.5 font-bold text-right">DISC</th>}
            {isVisible('show_col_total') && <th className="py-0.5 font-bold text-right">TOTAL</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx} className="border-b border-dotted border-gray-300">
              {isVisible('show_col_product_name') && (
                <td className="py-1 pr-1 font-semibold align-top">
                  {item.product_name}
                  {item.is_loose ? <span className="text-[8px] font-normal block text-gray-600">(Loose)</span> : null}
                </td>
              )}
              {isVisible('show_col_p_code') && (
                <td className="py-1 text-[8px] align-top text-gray-700 font-mono">{item.p_code || '-'}</td>
              )}
              {isVisible('show_col_unit') && (
                <td className="py-1 text-center align-top whitespace-nowrap">
                  {item.quantity} {item.unit_type ? <span className="text-[8px] text-gray-600">{item.unit_type}</span> : ''}
                </td>
              )}
              {isVisible('show_col_unit_price') && (
                <td className="py-1 text-right align-top">{item.unit_price.toFixed(2)}</td>
              )}
              {isVisible('show_col_discount') && (
                <td className="py-1 text-right align-top">
                  {item.discount_amount > 0 ? item.discount_amount.toFixed(1) : '-'}
                </td>
              )}
              {isVisible('show_col_total') && (
                <td className="py-1 text-right font-bold align-top">{item.net_amount.toFixed(2)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // Two-line rows: name on the first line, "qty x rate ... total" on the second. Fits a 48mm printable width.
  const renderStackedRow = (item: SaleItem, idx: number, detailed: boolean) => {
    const qtyText = isVisible('show_col_unit') ? `${item.quantity}${item.unit_type ? ` ${item.unit_type}` : ''}` : '';
    const rateText = isVisible('show_col_unit_price') ? item.unit_price.toFixed(2) : '';
    const calcText = [qtyText, rateText].filter(Boolean).join(' x ');
    const showDiscount = detailed && isVisible('show_col_discount') && item.discount_amount > 0;
    const showCodeLine = detailed && !is58 && isVisible('show_col_p_code') && (item.p_code || item.location_rack);

    return (
      <div key={idx} className="py-1 border-b border-dotted border-gray-300 last:border-b-0">
        {isVisible('show_col_product_name') && (
          <div className="font-semibold">
            {detailed && <span className="text-gray-600 mr-1">{idx + 1}.</span>}
            {item.product_name}
            {item.is_loose ? <span className="font-normal text-gray-600"> (Loose)</span> : null}
          </div>
        )}
        {showCodeLine && (
          <div className={`${fs.xs} text-gray-700 font-mono`}>
            {item.p_code ? `Code: ${item.p_code}` : ''}
            {item.p_code && item.location_rack ? ' · ' : ''}
            {item.location_rack ? `Rack: ${item.location_rack}` : ''}
          </div>
        )}
        <div className="flex justify-between gap-2">
          <span className="text-gray-800">
            {calcText}
            {showDiscount && <span className="text-gray-600"> (-{item.discount_amount.toFixed(2)})</span>}
          </span>
          {isVisible('show_col_total') && <span className="font-bold whitespace-nowrap">{item.net_amount.toFixed(2)}</span>}
        </div>
      </div>
    );
  };

  const itemsStacked = (detailed: boolean) => (
    <div className={`py-1.5 border-b border-dashed border-black ${fs.xs}`}>
      {items.map((item, idx) => renderStackedRow(item, idx, detailed))}
    </div>
  );

  const row = (label: string, value: string, className = '') => (
    <div className={`flex justify-between gap-2 ${className}`}>
      <span>{label}</span>
      <span className="whitespace-nowrap">{value}</span>
    </div>
  );

  const totals = (
    <div className={`py-2 border-b border-dashed border-black space-y-0.5 ${fs.sm}`}>
      {template !== 'compact' && isVisible('show_summary_item_count') &&
        row('Total Items:', `${totalItemsCount} (${totalUnitsCount} units)`, 'text-gray-700')}
      {template !== 'compact' && isVisible('show_summary_gross') &&
        row('Gross Total:', `${money(invoice.total_gross)}`)}
      {template === 'classic' && isVisible('show_summary_discount') && totalDiscount > 0 &&
        row('Total Discount:', `-${money(totalDiscount)}`, 'text-gray-700')}
      {template === 'detailed' && isVisible('show_summary_discount') && invoice.total_item_discount > 0 &&
        row('Line Item Discounts:', `-${money(invoice.total_item_discount)}`, 'text-gray-700')}
      {template === 'detailed' && isVisible('show_summary_discount') && invoice.bill_discount_amt > 0 &&
        row(`Bill Discount (${invoice.bill_discount_pct}%):`, `-${money(invoice.bill_discount_amt)}`, 'text-gray-700')}
      {template === 'compact' && isVisible('show_summary_discount') && totalDiscount > 0 &&
        row('Discount:', `-${money(totalDiscount)}`, 'text-gray-700')}
      {isVisible('show_summary_net') &&
        row('NET PAYABLE:', `${money(invoice.net_total)}`, `${fs.net} font-extrabold pt-1 border-t border-dotted border-black`)}
      {isVisible('show_summary_received') &&
        row('Cash Tendered:', `${money(invoice.cash_tendered)}`, 'pt-0.5')}
      {isVisible('show_summary_change') &&
        row('Change Due:', `${money(invoice.change_due)}`, 'font-bold text-gray-900')}
    </div>
  );

  const barcode = isVisible('show_invoice_no') && (
    <div className="text-center py-2 border-b border-dashed border-black">
      <div className={`font-mono tracking-widest ${is58 ? 'text-[11px]' : 'text-[13px]'} font-bold`}>|||| | ||||| || |||||| | |||</div>
      <div className="text-[8px] font-mono tracking-wider">{invoice.invoice_no}</div>
    </div>
  );

  const policies = (
    <div className={`pt-2 ${fs.xs} text-gray-800 space-y-1`}>
      {template !== 'compact' && isVisible('show_terms') && terms && (
        <div>
          <div className="font-bold text-center uppercase tracking-wider">Terms & Conditions</div>
          <div className="whitespace-pre-line text-left leading-tight">{terms}</div>
        </div>
      )}
      {template === 'detailed' && isVisible('show_return_policy') && returnPolicy && (
        <div>
          <div className="font-bold text-center uppercase tracking-wider pt-1">Return Policy</div>
          <div className="whitespace-pre-line text-left leading-tight">{returnPolicy}</div>
        </div>
      )}
      {isVisible('show_footer_note') && footerNote && (
        <div className="text-center italic pt-1">{footerNote}</div>
      )}
    </div>
  );

  // Developer-controlled footer: mandatory on every design, wraps long text and unbroken strings
  const developerFooterBlock = (
    <div
      data-testid="developer-invoice-footer"
      className="text-center pt-2 mt-2 border-t border-dashed border-black text-[8px] text-gray-600 font-mono tracking-wide whitespace-pre-wrap wrap-anywhere"
    >
      {developerFooter}
    </div>
  );

  // Classic keeps the full column table on 80mm; every design switches to two-line rows on 58mm
  const itemsSection = template === 'classic' && !is58 ? itemsTable : itemsStacked(template === 'detailed');

  return (
    <div className="flex flex-col items-center w-full">
      {/* Zero page margins: the roll width is set on the receipt container and the thermal head's printable area */}
      <style>{`@media print { @page { margin: 0; } }`}</style>

      {/* On-screen Preview Controls */}
      {showControls && (
        <div className="w-full max-w-4xl flex flex-wrap justify-between items-center gap-2 mb-4 p-2.5 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 no-print">
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
            <Receipt className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span>{paperSize.replace('mm', ' mm')} · {TEMPLATE_LABELS[template]}</span>
          </span>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-start gap-2">
            {extraActions}
            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-500 text-white font-bold text-[12px] rounded-lg shadow-xs transition-colors flex items-center space-x-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Invoice</span>
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-[12px] rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {/* Actual Printable Thermal Receipt */}
      <div
        id="thermal-receipt-printable"
        ref={receiptRef}
        data-template={template}
        data-paper-size={paperSize}
        className={`bg-white text-black shadow-xl border border-slate-300 rounded-xs transition-all wrap-break-word ${
          is58 ? 'print-paper-58mm w-[58mm] p-2' : 'print-paper-80mm w-[80mm] p-3'
        }`}
      >
        <div className={`${fs.base} font-mono leading-tight`}>
          {header}
          {invoiceMeta}
          {itemsSection}
          {totals}
          {template !== 'compact' && barcode}
          {policies}
          {developerFooterBlock}
        </div>
      </div>
    </div>
  );
};
