import React, { useState } from 'react';
import { SaleInvoice, SystemSettings, InvoiceTemplateType } from '../../types';
import { Printer, FileText, Receipt, LayoutDashboard } from 'lucide-react';

interface UnifiedInvoiceProps {
  invoice: SaleInvoice;
  settings?: SystemSettings | null;
  templateOverride?: InvoiceTemplateType;
  onPrint?: () => void;
  onClose?: () => void;
  showControls?: boolean;
}

export const UnifiedInvoice: React.FC<UnifiedInvoiceProps> = ({
  invoice,
  settings,
  templateOverride,
  onPrint,
  onClose,
  showControls = true
}) => {
  // Determine effective template: override prop > user selection > default setting > 'thermal'
  const defaultTemplate = (settings?.default_invoice_template as InvoiceTemplateType) || 'thermal';
  const [selectedTemplate, setSelectedTemplate] = useState<InvoiceTemplateType>(templateOverride || defaultTemplate);

  const effectiveTemplate = templateOverride || selectedTemplate;

  // Settings & Values
  const storeName = settings?.store_name || 'AL-SHIFA PHARMACY & HEALTHCARE';
  const storeAddress = settings?.store_address || 'Suite #12-14, Health Plaza, Main Commercial Ave';
  const storePhone = settings?.store_phone || '+92 300 9876543 / 051-4567890';
  const drugLicenseNo = settings?.drug_license_no || 'DL-PHARM-2024-9981';
  const taxNo = settings?.tax_no || 'NTN: 7392819-1';
  const headerNote = settings?.receipt_header || 'Certified Pharmacist on Duty';
  const footerNote = settings?.receipt_footer || 'Thank you for your visit!';
  const terms = settings?.receipt_terms || '1. Returns accepted within 3 days with original invoice.\n2. Refrigerated cold-chain medicines & loose items are non-returnable.';
  const returnPolicy = settings?.return_policy_text || 'Unopened medicines in original packaging may be returned or exchanged within 3 days with this invoice. Heat-sensitive and loose units are non-returnable.';
  const currency = settings?.currency_symbol || 'Rs.';

  // Helper for field visibility (default is true unless strictly 'false')
  const isVisible = (key: string) => settings?.[key] !== 'false';

  // Paper Size & Class
  const paperSize = settings?.invoice_paper_size || settings?.paper_width || (effectiveTemplate === 'thermal' ? '80mm' : 'A4');
  
  const getPaperClass = () => {
    if (effectiveTemplate === 'thermal') {
      return paperSize === '58mm' ? 'print-paper-58mm w-[58mm]' : 'print-paper-80mm w-[80mm]';
    }
    return paperSize === 'A5' ? 'print-paper-a5 w-full max-w-[148mm]' : 'print-paper-a4 w-full max-w-[210mm]';
  };

  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else {
      window.print();
    }
  };

  // Pre-calculated values
  const totalItemsCount = invoice.items?.length || 0;
  const totalUnitsCount = invoice.items?.reduce((acc, it) => acc + (it.quantity || 0), 0) || 0;
  const totalDiscount = (invoice.total_item_discount || 0) + (invoice.bill_discount_amt || 0);

  // Mandatory developer credit text
  const developerCredit = (
    <div className="text-center pt-2 mt-2 border-t border-slate-200 dark:border-slate-800 text-[8px] text-gray-500 font-mono tracking-wide">
      Software by <span className="font-bold text-gray-700">PharmaCare Pro Desktop</span> • 100% Offline Pharmacy Suite
    </div>
  );

  return (
    <div className="flex flex-col items-center w-full">
      {/* On-screen Preview Controls */}
      {showControls && (
        <div className="w-full max-w-4xl flex flex-wrap justify-between items-center gap-2 mb-4 p-2.5 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 no-print">
          {/* Template Switcher Buttons */}
          <div className="flex items-center space-x-1.5">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">Design:</span>
            <button
              type="button"
              onClick={() => setSelectedTemplate('thermal')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1 transition-all cursor-pointer ${
                effectiveTemplate === 'thermal'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>Thermal Receipt</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedTemplate('standard')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1 transition-all cursor-pointer ${
                effectiveTemplate === 'standard'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Standard Invoice</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedTemplate('detailed')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1 transition-all cursor-pointer ${
                effectiveTemplate === 'detailed'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Detailed Invoice</span>
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs rounded-lg shadow-sm transition-colors flex items-center space-x-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Invoice</span>
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {/* Actual Printable Invoice Container */}
      <div
        id="thermal-receipt-printable"
        className={`bg-white text-black p-4 shadow-xl border border-slate-300 rounded-xs transition-all ${getPaperClass()}`}
      >
        {/* ============================================================== */}
        {/* TEMPLATE 1: THERMAL RECEIPT (80mm / 58mm POS ROLL)             */}
        {/* ============================================================== */}
        {effectiveTemplate === 'thermal' && (
          <div className="text-[11px] font-mono leading-tight">
            {/* Pharmacy Header */}
            <div className="text-center pb-2 border-b border-dashed border-black">
              {isVisible('show_store_name') && (
                <div className="font-extrabold text-[14px] sm:text-[15px] tracking-wide uppercase">{storeName}</div>
              )}
              {isVisible('show_store_address') && (
                <div className="text-[10px] mt-0.5">{storeAddress}</div>
              )}
              {isVisible('show_store_phone') && (
                <div className="text-[10px]">Tel: {storePhone}</div>
              )}
              {isVisible('show_store_license') && (
                <div className="text-[9px] mt-1 font-bold">DRUG LIC: {drugLicenseNo} | {taxNo}</div>
              )}
              {headerNote && <div className="text-[9px] italic mt-0.5">{headerNote}</div>}
            </div>

            {/* Invoice Info */}
            <div className="py-2 text-[10px] border-b border-dashed border-black space-y-0.5">
              <div className="flex justify-between font-bold">
                {isVisible('show_invoice_no') && <span>INV: {invoice.invoice_no}</span>}
                <span>{invoice.payment_type.toUpperCase()}</span>
              </div>
              <div className="flex justify-between text-[9px] text-gray-700">
                {isVisible('show_invoice_date') && (
                  <span>
                    {new Date(invoice.sale_date).toLocaleDateString()} {new Date(invoice.sale_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {isVisible('show_cashier_name') && (
                  <span>Cashier: {invoice.user_name || 'Staff'}</span>
                )}
              </div>
              {isVisible('show_customer_name') && invoice.customer_name && (
                <div className="text-[9px]">
                  Customer: {invoice.customer_name}
                  {isVisible('show_customer_phone') && invoice.customer_phone ? ` (${invoice.customer_phone})` : ''}
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="py-2 border-b border-dashed border-black">
              <table className="w-full text-[9px]">
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
                  {invoice.items?.map((item, idx) => (
                    <tr key={idx} className="border-b border-dotted border-gray-300">
                      {isVisible('show_col_product_name') && (
                        <td className="py-1 pr-1 font-semibold align-top">
                          {item.product_name}
                          {item.is_loose ? <span className="text-[8px] font-normal block text-gray-600">(Loose)</span> : null}
                        </td>
                      )}
                      {isVisible('show_col_p_code') && (
                        <td className="py-1 text-[8px] align-top text-gray-700 font-mono">
                          {item.p_code || '-'}
                        </td>
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

            {/* Calculations / Financial Totals */}
            <div className="py-2 border-b border-dashed border-black space-y-0.5 text-[10px]">
              {isVisible('show_summary_item_count') && (
                <div className="flex justify-between text-gray-700">
                  <span>Total Items:</span>
                  <span>{totalItemsCount} ({totalUnitsCount} units)</span>
                </div>
              )}
              {isVisible('show_summary_gross') && (
                <div className="flex justify-between">
                  <span>Gross Total:</span>
                  <span>{currency} {invoice.total_gross.toFixed(2)}</span>
                </div>
              )}
              {isVisible('show_summary_discount') && totalDiscount > 0 && (
                <div className="flex justify-between text-gray-700">
                  <span>Total Discount:</span>
                  <span>-{currency} {totalDiscount.toFixed(2)}</span>
                </div>
              )}
              {isVisible('show_summary_net') && (
                <div className="flex justify-between text-[13px] font-extrabold pt-1 border-t border-dotted border-black">
                  <span>NET PAYABLE:</span>
                  <span>{currency} {invoice.net_total.toFixed(2)}</span>
                </div>
              )}
              {isVisible('show_summary_received') && (
                <div className="flex justify-between pt-0.5 text-[10px]">
                  <span>Cash Tendered:</span>
                  <span>{currency} {invoice.cash_tendered.toFixed(2)}</span>
                </div>
              )}
              {isVisible('show_summary_change') && (
                <div className="flex justify-between text-[11px] font-bold text-gray-900">
                  <span>Change Due:</span>
                  <span>{currency} {invoice.change_due.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Barcode Simulation */}
            {isVisible('show_invoice_no') && (
              <div className="text-center py-2 border-b border-dashed border-black">
                <div className="font-mono tracking-widest text-[13px] font-bold">|||| | ||||| || |||||| | |||</div>
                <div className="text-[8px] font-mono tracking-wider">{invoice.invoice_no}</div>
              </div>
            )}

            {/* Terms & Return Policy */}
            <div className="pt-2 text-[8px] text-gray-800 space-y-1">
              {isVisible('show_terms') && (
                <div>
                  <div className="font-bold text-center uppercase tracking-wider">Terms & Conditions</div>
                  <div className="whitespace-pre-line text-left leading-tight">{terms}</div>
                </div>
              )}
              {isVisible('show_return_policy') && returnPolicy && (
                <div>
                  <div className="font-bold text-center uppercase tracking-wider pt-1">Return Policy</div>
                  <div className="whitespace-pre-line text-left leading-tight">{returnPolicy}</div>
                </div>
              )}
              {isVisible('show_footer_note') && (
                <div className="text-center italic pt-1">{footerNote}</div>
              )}
            </div>

            {/* Mandatory Developer Attribution */}
            {developerCredit}
          </div>
        )}

        {/* ============================================================== */}
        {/* TEMPLATE 2: STANDARD INVOICE (CLEAN A4 / A5 SHEET)             */}
        {/* ============================================================== */}
        {effectiveTemplate === 'standard' && (
          <div className="text-[12px] font-sans leading-normal">
            {/* Header Section */}
            <div className="flex justify-between items-start pb-4 border-b-2 border-teal-600">
              <div>
                {isVisible('show_store_name') && (
                  <h1 className="text-xl font-black text-teal-800 tracking-tight uppercase">{storeName}</h1>
                )}
                {isVisible('show_store_address') && (
                  <p className="text-xs text-gray-600 mt-0.5">{storeAddress}</p>
                )}
                {isVisible('show_store_phone') && (
                  <p className="text-xs text-gray-600 font-medium">Phone: {storePhone}</p>
                )}
                {isVisible('show_store_license') && (
                  <p className="text-[11px] font-semibold text-gray-700 mt-1">
                    Drug License: <span className="font-mono">{drugLicenseNo}</span> | NTN: <span className="font-mono">{taxNo}</span>
                  </p>
                )}
              </div>
              <div className="text-right">
                <span className="inline-block px-3 py-1 bg-teal-100 text-teal-800 font-bold text-xs uppercase tracking-wider rounded-md border border-teal-300">
                  Tax Invoice
                </span>
                {isVisible('show_invoice_no') && (
                  <div className="text-sm font-extrabold font-mono text-gray-900 mt-1.5">
                    #{invoice.invoice_no}
                  </div>
                )}
                {isVisible('show_invoice_date') && (
                  <div className="text-xs text-gray-500 font-medium">
                    {new Date(invoice.sale_date).toLocaleDateString()} {new Date(invoice.sale_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            </div>

            {/* Bill To & Cashier Meta Bar */}
            <div className="grid grid-cols-2 gap-4 my-4 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <div>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Customer Details</span>
                {isVisible('show_customer_name') ? (
                  <div className="font-bold text-gray-900 text-sm mt-0.5">
                    {invoice.customer_name || 'Counter Sale / Walk-in Customer'}
                  </div>
                ) : (
                  <div className="font-bold text-gray-900">Walk-in Customer</div>
                )}
                {isVisible('show_customer_phone') && invoice.customer_phone && (
                  <div className="text-gray-600 font-mono mt-0.5">{invoice.customer_phone}</div>
                )}
              </div>

              <div className="text-right flex flex-col justify-center">
                <div className="flex justify-end space-x-2">
                  <span className="text-gray-500">Payment Method:</span>
                  <span className="font-bold uppercase text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                    {invoice.payment_type}
                  </span>
                </div>
                {isVisible('show_cashier_name') && (
                  <div className="text-gray-500 text-[11px] mt-1">
                    Billed by: <span className="font-semibold text-gray-800">{invoice.user_name || 'Staff Cashier'}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Items Table */}
            <div className="my-4 border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-gray-700 uppercase text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    {isVisible('show_col_product_name') && <th className="py-2 px-3">Item Description</th>}
                    {isVisible('show_col_p_code') && <th className="py-2 px-3 font-mono">Code / SKU</th>}
                    {isVisible('show_col_unit') && <th className="py-2 px-3 text-center">Qty</th>}
                    {isVisible('show_col_unit_price') && <th className="py-2 px-3 text-right">Unit Price</th>}
                    {isVisible('show_col_discount') && <th className="py-2 px-3 text-right">Discount</th>}
                    {isVisible('show_col_total') && <th className="py-2 px-3 text-right">Net Amount</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.items?.map((item, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                      <td className="py-2 px-3 text-gray-500 font-mono">{idx + 1}</td>
                      {isVisible('show_col_product_name') && (
                        <td className="py-2 px-3 font-semibold text-gray-900">
                          {item.product_name}
                          {item.is_loose && (
                            <span className="ml-1.5 text-[10px] font-normal text-amber-700 bg-amber-50 px-1 py-0.5 rounded border border-amber-200">
                              Loose Unit
                            </span>
                          )}
                        </td>
                      )}
                      {isVisible('show_col_p_code') && (
                        <td className="py-2 px-3 font-mono text-gray-600 text-[11px]">{item.p_code || '-'}</td>
                      )}
                      {isVisible('show_col_unit') && (
                        <td className="py-2 px-3 text-center font-bold">
                          {item.quantity} <span className="font-normal text-gray-500 text-[10px]">{item.unit_type || 'units'}</span>
                        </td>
                      )}
                      {isVisible('show_col_unit_price') && (
                        <td className="py-2 px-3 text-right font-mono">{item.unit_price.toFixed(2)}</td>
                      )}
                      {isVisible('show_col_discount') && (
                        <td className="py-2 px-3 text-right font-mono text-gray-600">
                          {item.discount_amount > 0 ? item.discount_amount.toFixed(2) : '-'}
                        </td>
                      )}
                      {isVisible('show_col_total') && (
                        <td className="py-2 px-3 text-right font-mono font-bold text-gray-900">
                          {item.net_amount.toFixed(2)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bottom Section: Terms on Left, Totals on Right */}
            <div className="grid grid-cols-2 gap-6 my-4 pt-2">
              <div className="space-y-3 text-xs text-gray-600">
                {isVisible('show_terms') && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <span className="font-bold text-gray-800 block text-[11px] uppercase tracking-wider mb-1">
                      Terms & Conditions:
                    </span>
                    <p className="whitespace-pre-line text-[11px] leading-relaxed">{terms}</p>
                  </div>
                )}
                {isVisible('show_return_policy') && returnPolicy && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <span className="font-bold text-gray-800 block text-[11px] uppercase tracking-wider mb-1">
                      Return & Exchange Policy:
                    </span>
                    <p className="whitespace-pre-line text-[11px] leading-relaxed">{returnPolicy}</p>
                  </div>
                )}
              </div>

              {/* Financial Totals */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs">
                {isVisible('show_summary_item_count') && (
                  <div className="flex justify-between text-gray-600">
                    <span>Total Items:</span>
                    <span className="font-semibold">{totalItemsCount} items ({totalUnitsCount} units)</span>
                  </div>
                )}
                {isVisible('show_summary_gross') && (
                  <div className="flex justify-between text-gray-700">
                    <span>Subtotal / Gross:</span>
                    <span className="font-mono font-semibold">{currency} {invoice.total_gross.toFixed(2)}</span>
                  </div>
                )}
                {isVisible('show_summary_discount') && totalDiscount > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Total Discount:</span>
                    <span className="font-mono font-semibold">-{currency} {totalDiscount.toFixed(2)}</span>
                  </div>
                )}
                {isVisible('show_summary_net') && (
                  <div className="flex justify-between text-sm font-extrabold text-teal-900 pt-2 border-t border-slate-300">
                    <span>NET PAYABLE:</span>
                    <span className="font-mono text-base">{currency} {invoice.net_total.toFixed(2)}</span>
                  </div>
                )}
                {isVisible('show_summary_received') && (
                  <div className="flex justify-between text-gray-700 pt-1">
                    <span>Amount Received:</span>
                    <span className="font-mono">{currency} {invoice.cash_tendered.toFixed(2)}</span>
                  </div>
                )}
                {isVisible('show_summary_change') && (
                  <div className="flex justify-between text-gray-900 font-bold">
                    <span>Change Due:</span>
                    <span className="font-mono">{currency} {invoice.change_due.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Signatures & Footer Note */}
            <div className="grid grid-cols-2 gap-4 mt-8 pt-4 border-t border-slate-200 text-center text-xs">
              <div className="pt-4">
                <div className="border-t border-slate-400 w-3/4 mx-auto mb-1"></div>
                <span className="text-gray-500 text-[10px] uppercase tracking-wider font-semibold">Customer Signature</span>
              </div>
              <div className="pt-4">
                <div className="border-t border-slate-400 w-3/4 mx-auto mb-1"></div>
                <span className="text-gray-500 text-[10px] uppercase tracking-wider font-semibold">Pharmacist Stamp / Authorized Signature</span>
              </div>
            </div>

            {isVisible('show_footer_note') && (
              <div className="text-center italic text-xs text-gray-600 mt-4">{footerNote}</div>
            )}

            {/* Mandatory Developer Attribution */}
            {developerCredit}
          </div>
        )}

        {/* ============================================================== */}
        {/* TEMPLATE 3: DETAILED INVOICE (PHARMACEUTICAL ENTERPRISE)       */}
        {/* ============================================================== */}
        {effectiveTemplate === 'detailed' && (
          <div className="text-[12px] font-sans leading-normal">
            {/* Enterprise Top Banner */}
            <div className="p-4 bg-slate-900 text-white rounded-lg mb-4 flex justify-between items-center">
              <div>
                {isVisible('show_store_name') && (
                  <h1 className="text-xl font-black tracking-wide uppercase text-teal-300">{storeName}</h1>
                )}
                {headerNote && <p className="text-xs text-teal-100 italic mt-0.5">{headerNote}</p>}
                {isVisible('show_store_license') && (
                  <p className="text-[11px] text-slate-300 mt-1 font-mono">
                    Drug Lic: <span className="text-white font-bold">{drugLicenseNo}</span> | NTN: <span className="text-white font-bold">{taxNo}</span>
                  </p>
                )}
              </div>
              <div className="text-right">
                <div className="bg-teal-500 text-slate-950 font-black text-xs px-3 py-1 rounded uppercase tracking-wider inline-block">
                  Enterprise Tax Invoice
                </div>
                {isVisible('show_invoice_no') && (
                  <div className="text-base font-extrabold font-mono text-white mt-1">
                    {invoice.invoice_no}
                  </div>
                )}
                {isVisible('show_invoice_date') && (
                  <div className="text-[11px] text-slate-300">
                    {new Date(invoice.sale_date).toLocaleDateString()} {new Date(invoice.sale_date).toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>

            {/* Three-Column Information Bar */}
            <div className="grid grid-cols-3 gap-3 mb-4 text-xs">
              {/* Store Contact */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1">
                  Pharmacy Location
                </span>
                {isVisible('show_store_address') && <p className="text-gray-700 leading-tight">{storeAddress}</p>}
                {isVisible('show_store_phone') && <p className="text-gray-700 font-semibold mt-1">Tel: {storePhone}</p>}
              </div>

              {/* Customer Profile */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1">
                  Customer Profile
                </span>
                {isVisible('show_customer_name') && (
                  <div className="font-bold text-gray-900 text-sm">{invoice.customer_name || 'Walk-in Retail Customer'}</div>
                )}
                {isVisible('show_customer_phone') && invoice.customer_phone && (
                  <div className="text-gray-600 font-mono mt-0.5">Phone: {invoice.customer_phone}</div>
                )}
              </div>

              {/* Transaction Specs */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1">
                  Sale Parameters
                </span>
                <div className="flex justify-between">
                  <span className="text-gray-500">Payment:</span>
                  <span className="font-bold uppercase text-teal-800">{invoice.payment_type}</span>
                </div>
                {isVisible('show_cashier_name') && (
                  <div className="flex justify-between mt-0.5">
                    <span className="text-gray-500">Dispensed By:</span>
                    <span className="font-semibold text-gray-800">{invoice.user_name || 'Pharmacist'}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Detailed Products Table */}
            <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-800 text-slate-200 uppercase text-[10px] tracking-wider font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">#</th>
                    {isVisible('show_col_product_name') && <th className="py-2.5 px-3">Medicine / Product Details</th>}
                    {isVisible('show_col_p_code') && <th className="py-2.5 px-3 font-mono">Code / Loc</th>}
                    {isVisible('show_col_unit') && <th className="py-2.5 px-3 text-center">Packaging / Qty</th>}
                    {isVisible('show_col_unit_price') && <th className="py-2.5 px-3 text-right">Unit Rate</th>}
                    {isVisible('show_col_discount') && <th className="py-2.5 px-3 text-right">Disc</th>}
                    {isVisible('show_col_total') && <th className="py-2.5 px-3 text-right">Net Total</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.items?.map((item, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}>
                      <td className="py-2.5 px-3 font-mono text-gray-500">{idx + 1}</td>
                      {isVisible('show_col_product_name') && (
                        <td className="py-2.5 px-3 font-bold text-gray-900">
                          {item.product_name}
                          {item.is_loose && (
                            <span className="ml-2 text-[10px] font-semibold text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                              Loose Unit
                            </span>
                          )}
                        </td>
                      )}
                      {isVisible('show_col_p_code') && (
                        <td className="py-2.5 px-3 font-mono text-[11px] text-gray-600">
                          <span>{item.p_code || '-'}</span>
                          {item.location_rack && <span className="block text-[9px] text-gray-500 font-sans">Loc: {item.location_rack}</span>}
                        </td>
                      )}
                      {isVisible('show_col_unit') && (
                        <td className="py-2.5 px-3 text-center font-bold">
                          {item.quantity} <span className="font-normal text-gray-500 text-[10px]">{item.unit_type || 'units'}</span>
                        </td>
                      )}
                      {isVisible('show_col_unit_price') && (
                        <td className="py-2.5 px-3 text-right font-mono">{item.unit_price.toFixed(2)}</td>
                      )}
                      {isVisible('show_col_discount') && (
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-700">
                          {item.discount_amount > 0 ? item.discount_amount.toFixed(2) : '-'}
                        </td>
                      )}
                      {isVisible('show_col_total') && (
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-gray-900">
                          {item.net_amount.toFixed(2)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Detailed Financial Audit & Policy Cards */}
            <div className="grid grid-cols-12 gap-4 mb-4">
              {/* Policies & Disclaimers (7 cols) */}
              <div className="col-span-7 space-y-3 text-xs">
                {isVisible('show_terms') && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <span className="font-bold text-gray-900 uppercase tracking-wider text-[10px] block mb-1">
                      Pharmacy Regulatory & Dispensing Terms:
                    </span>
                    <p className="whitespace-pre-line text-[11px] text-gray-600 leading-relaxed">{terms}</p>
                  </div>
                )}
                {isVisible('show_return_policy') && returnPolicy && (
                  <div className="p-3 bg-teal-50/50 border border-teal-200 rounded-lg">
                    <span className="font-bold text-teal-900 uppercase tracking-wider text-[10px] block mb-1">
                      Return & Exchange Guidelines:
                    </span>
                    <p className="whitespace-pre-line text-[11px] text-teal-800 leading-relaxed">{returnPolicy}</p>
                  </div>
                )}
              </div>

              {/* Complete Financial Breakdown (5 cols) */}
              <div className="col-span-5 p-4 bg-slate-900 text-white rounded-lg space-y-2 text-xs">
                <span className="font-extrabold text-[10px] uppercase tracking-wider text-teal-400 block pb-1 border-b border-slate-700">
                  Financial Settlement Summary
                </span>
                {isVisible('show_summary_item_count') && (
                  <div className="flex justify-between text-slate-300">
                    <span>Item & Unit Count:</span>
                    <span>{totalItemsCount} items / {totalUnitsCount} units</span>
                  </div>
                )}
                {isVisible('show_summary_gross') && (
                  <div className="flex justify-between text-slate-200">
                    <span>Gross Sales Total:</span>
                    <span className="font-mono">{currency} {invoice.total_gross.toFixed(2)}</span>
                  </div>
                )}
                {invoice.total_item_discount > 0 && isVisible('show_summary_discount') && (
                  <div className="flex justify-between text-teal-300">
                    <span>Line Item Discounts:</span>
                    <span className="font-mono">-{currency} {invoice.total_item_discount.toFixed(2)}</span>
                  </div>
                )}
                {invoice.bill_discount_amt > 0 && isVisible('show_summary_discount') && (
                  <div className="flex justify-between text-teal-300">
                    <span>Bill Discount ({invoice.bill_discount_pct}%):</span>
                    <span className="font-mono">-{currency} {invoice.bill_discount_amt.toFixed(2)}</span>
                  </div>
                )}
                {isVisible('show_summary_net') && (
                  <div className="flex justify-between text-base font-black text-teal-400 pt-2 border-t border-slate-700">
                    <span>NET PAYABLE:</span>
                    <span className="font-mono">{currency} {invoice.net_total.toFixed(2)}</span>
                  </div>
                )}
                {isVisible('show_summary_received') && (
                  <div className="flex justify-between text-slate-300 pt-1">
                    <span>Tendered Amount:</span>
                    <span className="font-mono">{currency} {invoice.cash_tendered.toFixed(2)}</span>
                  </div>
                )}
                {isVisible('show_summary_change') && (
                  <div className="flex justify-between text-white font-bold">
                    <span>Change / Balance:</span>
                    <span className="font-mono">{currency} {invoice.change_due.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Signature & Barcode Section */}
            <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-slate-200 text-xs items-center">
              <div>
                {isVisible('show_invoice_no') && (
                  <div className="font-mono text-center">
                    <div className="tracking-widest font-bold text-sm">|||| | ||||| || |||||| | |||</div>
                    <span className="text-[10px] text-gray-500">{invoice.invoice_no}</span>
                  </div>
                )}
              </div>
              <div className="text-center">
                <div className="border-t border-slate-400 w-3/4 mx-auto mb-1"></div>
                <span className="text-gray-600 text-[10px] uppercase font-bold tracking-wider">Authorized Pharmacist Sign & Stamp</span>
              </div>
            </div>

            {isVisible('show_footer_note') && (
              <div className="text-center italic text-xs text-gray-600 mt-4">{footerNote}</div>
            )}

            {/* Mandatory Developer Attribution */}
            {developerCredit}
          </div>
        )}
      </div>
    </div>
  );
};
