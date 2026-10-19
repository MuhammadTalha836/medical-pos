import React from 'react';
import { SaleInvoice, SystemSettings } from '../../types';

interface ThermalReceiptProps {
  invoice: SaleInvoice;
  settings?: SystemSettings | null;
  onPrint?: () => void;
  onClose?: () => void;
}

export const ThermalReceipt: React.FC<ThermalReceiptProps> = ({
  invoice,
  settings,
  onPrint,
  onClose
}) => {
  const storeName = settings?.store_name || 'AL-SHIFA PHARMACY & HEALTHCARE';
  const storeAddress = settings?.store_address || 'Suite #12-14, Health Plaza, Main Commercial Ave';
  const storePhone = settings?.store_phone || '+92 300 9876543 / 051-4567890';
  const drugLicenseNo = settings?.drug_license_no || 'DL-PHARM-2024-9981';
  const taxNo = settings?.tax_no || 'NTN: 7392819-1';
  const headerNote = settings?.receipt_header || 'Certified Pharmacist on Duty';
  const footerNote = settings?.receipt_footer || 'Thank you for your visit!';
  const terms = settings?.receipt_terms || '1. Returns accepted within 3 days with original invoice.\n2. Refrigerated cold-chain medicines & loose items are non-returnable.';
  const currency = settings?.currency_symbol || 'Rs.';

  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else {
      window.print();
    }
  };

  return (
    <div className="flex flex-col items-center">
      {/* Action Controls for on-screen preview */}
      <div className="w-full flex justify-between items-center mb-4 no-print">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Thermal 80mm POS Receipt</span>
        <div className="flex space-x-2">
          <button
            onClick={handlePrint}
            className="px-4 py-1.5 bg-teal-600 hover:bg-teal-500 text-white font-medium text-xs rounded-lg shadow-md transition-colors flex items-center space-x-1"
          >
            <span>Print Receipt</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs rounded-lg transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>

      {/* Actual Printable Receipt Container */}
      <div
        id="thermal-receipt-printable"
        className="w-[80mm] bg-white text-black p-4 text-[11px] font-mono leading-tight shadow-xl rounded-sm border border-slate-300"
      >
        {/* Pharmacy Header */}
        <div className="text-center pb-2 border-b border-dashed border-black">
          <div className="font-extrabold text-[15px] tracking-wide uppercase">{storeName}</div>
          <div className="text-[10px] mt-0.5">{storeAddress}</div>
          <div className="text-[10px]">Tel: {storePhone}</div>
          <div className="text-[9px] mt-1 font-bold">DRUG LIC: {drugLicenseNo} | {taxNo}</div>
          {headerNote && <div className="text-[9px] italic mt-0.5">{headerNote}</div>}
        </div>

        {/* Invoice Info */}
        <div className="py-2 text-[10px] border-b border-dashed border-black space-y-0.5">
          <div className="flex justify-between font-bold">
            <span>INVOICE: {invoice.invoice_no}</span>
            <span>{invoice.payment_type.toUpperCase()}</span>
          </div>
          <div className="flex justify-between text-[9px] text-gray-700">
            <span>Date: {new Date(invoice.sale_date).toLocaleDateString()} {new Date(invoice.sale_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span>By: {invoice.user_name || 'Cashier'}</span>
          </div>
          <div className="text-[9px]">Customer: {invoice.customer_name}</div>
        </div>

        {/* Items Table */}
        <div className="py-2 border-b border-dashed border-black">
          <table className="w-full text-[9px]">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-0.5 font-bold">LOC</th>
                <th className="py-0.5 font-bold">ITEM</th>
                <th className="py-0.5 font-bold text-center">QTY</th>
                <th className="py-0.5 font-bold text-right">RATE</th>
                <th className="py-0.5 font-bold text-right">DISC</th>
                <th className="py-0.5 font-bold text-right">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items?.map((item, idx) => (
                <tr key={idx} className="border-b border-dotted border-gray-300">
                  <td className="py-1 text-[8px] align-top">{item.location_rack || '-'}</td>
                  <td className="py-1 pr-1 font-semibold align-top">
                    {item.product_name}
                    {item.is_loose ? <span className="text-[8px] font-normal block text-gray-600">(Loose Unit)</span> : null}
                  </td>
                  <td className="py-1 text-center align-top">{item.quantity}</td>
                  <td className="py-1 text-right align-top">{item.unit_price.toFixed(2)}</td>
                  <td className="py-1 text-right align-top">{item.discount_amount > 0 ? item.discount_amount.toFixed(1) : '-'}</td>
                  <td className="py-1 text-right font-bold align-top">{item.net_amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Calculations / Totals */}
        <div className="py-2 border-b border-dashed border-black space-y-0.5 text-[10px]">
          <div className="flex justify-between">
            <span>Gross Total:</span>
            <span>{currency} {invoice.total_gross.toFixed(2)}</span>
          </div>
          {invoice.total_item_discount > 0 && (
            <div className="flex justify-between text-gray-700">
              <span>Item Discount:</span>
              <span>-{currency} {invoice.total_item_discount.toFixed(2)}</span>
            </div>
          )}
          {invoice.bill_discount_amt > 0 && (
            <div className="flex justify-between text-gray-700">
              <span>Bill Discount ({invoice.bill_discount_pct}%):</span>
              <span>-{currency} {invoice.bill_discount_amt.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-[13px] font-extrabold pt-1 border-t border-dotted border-black">
            <span>NET PAYABLE:</span>
            <span>{currency} {invoice.net_total.toFixed(2)}</span>
          </div>
          <div className="flex justify-between pt-0.5 text-[10px]">
            <span>Cash Tendered:</span>
            <span>{currency} {invoice.cash_tendered.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-[11px] font-bold text-gray-900">
            <span>Change Due:</span>
            <span>{currency} {invoice.change_due.toFixed(2)}</span>
          </div>
        </div>

        {/* Barcode Simulation */}
        <div className="text-center py-2 border-b border-dashed border-black">
          <div className="font-mono tracking-widest text-[14px] font-bold">|||| | ||||| || |||||| | |||</div>
          <div className="text-[8px] font-mono tracking-wider">{invoice.invoice_no}</div>
        </div>

        {/* Terms & Conditions */}
        <div className="pt-2 text-[8px] text-gray-800 space-y-1">
          <div className="font-bold text-center uppercase tracking-wider">Terms & Conditions</div>
          <div className="whitespace-pre-line text-left leading-tight">{terms}</div>
          <div className="text-center italic pt-1">{footerNote}</div>
          <div className="text-center text-[7px] text-gray-500 pt-0.5">Software Powered by PharmaCare Pro Desktop</div>
        </div>
      </div>
    </div>
  );
};
