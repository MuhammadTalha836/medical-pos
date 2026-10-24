import React, { useState, useEffect } from 'react';
import { api } from '../services/apiService';
import { SystemSettings } from '../types';
import {
  BarChart3,
  Calendar,
  Download,
  AlertTriangle,
  Package,
  DollarSign,
  TrendingUp,
  Building2,
  Printer
} from 'lucide-react';
import { moneyFormatter } from '../utils/format';

interface ReportsPageProps {
  settings?: SystemSettings | null;
}

type ReportType =
  | 'available_stock'
  | 'expired_stock'
  | 'finished_stock'
  | 'pnl_summary'
  | 'invoice_pnl'
  | 'product_sales'
  | 'company_sales';

export const ReportsPage: React.FC<ReportsPageProps> = ({ settings }) => {
  const [currentReport, setCurrentReport] = useState<ReportType>('available_stock');
  const [reportData, setReportData] = useState<any[]>([]);
  const [pnlSummary, setPnlSummary] = useState<any>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expiryDays, setExpiryDays] = useState('60');

  const money = moneyFormatter(settings);

  const loadCurrentReport = async () => {
    try {
      if (currentReport === 'available_stock') {
        const data = await api.getAvailableStockReport();
        setReportData(data);
      } else if (currentReport === 'expired_stock') {
        const data = await api.getExpiredStockReport(Number(expiryDays));
        setReportData(data);
      } else if (currentReport === 'finished_stock') {
        const data = await api.getFinishedStockReport();
        setReportData(data);
      } else if (currentReport === 'pnl_summary') {
        const data = await api.getPnlSummaryReport({ date_from: dateFrom, date_to: dateTo });
        setPnlSummary(data);
      } else if (currentReport === 'invoice_pnl') {
        const data = await api.getInvoicePnlReport({ date_from: dateFrom, date_to: dateTo });
        setReportData(data);
      } else if (currentReport === 'product_sales') {
        const data = await api.getProductWiseSalesReport();
        setReportData(data);
      } else if (currentReport === 'company_sales') {
        const data = await api.getCompanyWiseSalesReport();
        setReportData(data);
      }
    } catch (err) {
      console.error('Failed to load report:', err);
    }
  };

  useEffect(() => {
    loadCurrentReport();
  }, [currentReport, expiryDays]);

  const handleExportCSV = () => {
    if (reportData.length === 0) return;
    const headers = Object.keys(reportData[0]).join(',');
    const rows = reportData.map(row =>
      Object.values(row).map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `pharmacy_report_${currentReport}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const navButtons = [
    { id: 'available_stock' as ReportType, label: 'Available Stock Valuation', icon: Package },
    { id: 'expired_stock' as ReportType, label: 'Expired & Near-Expiry', icon: AlertTriangle },
    { id: 'finished_stock' as ReportType, label: 'Finished (Zero) Stock', icon: AlertTriangle },
    { id: 'pnl_summary' as ReportType, label: 'Profit & Loss Summary', icon: DollarSign },
    { id: 'invoice_pnl' as ReportType, label: 'Invoice-wise P&L', icon: TrendingUp },
    { id: 'product_sales' as ReportType, label: 'Product-wise Sales', icon: BarChart3 },
    { id: 'company_sales' as ReportType, label: 'Company-wise Sales', icon: Building2 },
  ];

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800 gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Pharmacy Reports & Financial Intelligence</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Real-time inventory valuation, batch expiries, COGS, and profit margins</p>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={handleExportCSV}
            disabled={reportData.length === 0}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 dark:bg-[#162032] dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs rounded-xl border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-40 shadow-xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => window.print()}
            className="btn-print px-3 py-1.5 text-xs flex items-center space-x-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Report</span>
          </button>
        </div>
      </div>

      {/* Navigation Pills */}
      <div className="flex flex-wrap gap-2">
        {navButtons.map((btn) => {
          const Icon = btn.icon;
          const isActive = currentReport === btn.id;
          return (
            <button
              key={btn.id}
              onClick={() => setCurrentReport(btn.id)}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                isActive
                  ? 'bg-teal-600 text-white border-teal-500 shadow-md shadow-teal-500/20'
                  : 'bg-white dark:bg-[#111827] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-[#162032] shadow-xs'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{btn.label}</span>
            </button>
          );
        })}
      </div>

      {/* Filters Bar for Date / Expiry parameters */}
      {(currentReport === 'pnl_summary' || currentReport === 'invoice_pnl') && (
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl flex items-center space-x-3 text-xs shadow-xs">
          <span className="text-slate-600 dark:text-slate-400 font-semibold flex items-center space-x-1">
            <Calendar className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span>Date Range:</span>
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-slate-900 dark:text-white font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-slate-900 dark:text-white font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
          />
          <button
            onClick={loadCurrentReport}
            className="btn-save px-3 py-1 text-xs"
          >
            Apply Filter
          </button>
        </div>
      )}

      {currentReport === 'expired_stock' && (
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl flex items-center space-x-3 text-xs shadow-xs">
          <span className="text-slate-700 dark:text-slate-300 font-semibold">Expiry Window:</span>
          <select
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value)}
            className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="0">Already Expired (Past Dates)</option>
            <option value="30">Expiring in next 30 days</option>
            <option value="60">Expiring in next 60 days</option>
            <option value="90">Expiring in next 90 days</option>
          </select>
        </div>
      )}

      {/* REPORT CONTENT AREA */}

      {/* 1. AVAILABLE STOCK VALUATION REPORT */}
      {currentReport === 'available_stock' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-xs">
              <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">Total Stock Items</span>
              <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1">{reportData.length}</div>
            </div>
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-xs">
              <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">Total Valuation at Cost (T-Price)</span>
              <div className="text-2xl font-bold font-mono text-teal-600 dark:text-teal-400 mt-1">
                {money(reportData.reduce((s, i) => s + (i.total_cost_value || 0), 0))}
              </div>
            </div>
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-xs">
              <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">Total Valuation at Retail (MRP)</span>
              <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                {money(reportData.reduce((s, i) => s + (i.total_retail_value || 0), 0))}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 uppercase font-semibold text-[11px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">C-Code</th>
                    <th className="py-2.5 px-3">P-Code</th>
                    <th className="py-2.5 px-3">Medicine Name</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3 text-center">Loc</th>
                    <th className="py-2.5 px-3 text-center">Stock</th>
                    <th className="py-2.5 px-3 text-right">T-Price</th>
                    <th className="py-2.5 px-3 text-right">Retail</th>
                    <th className="py-2.5 px-3 text-right">Cost Value</th>
                    <th className="py-2.5 px-3 text-right">Retail Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {reportData.map((p, idx) => (
                    <tr
                      key={p.id}
                      className={`transition-colors ${
                        idx % 2 === 0
                          ? 'bg-transparent'
                          : 'bg-slate-50/70 dark:bg-[#162032]/40'
                      } hover:bg-teal-500/5 dark:hover:bg-teal-500/10`}
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-teal-600 dark:text-teal-400">{p.c_code}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">{p.p_code}</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{p.name}</td>
                      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{p.unit_type}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-amber-600 dark:text-amber-400 font-semibold">{p.location_rack || '-'}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-900 dark:text-white">
                        {p.stock_boxes} Bx, {p.stock_loose} L
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500 dark:text-slate-400">{money(p.box_trade_price)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-200">{money(p.box_retail_price)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-teal-600 dark:text-teal-400 font-bold">{money(p.total_cost_value)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-600 dark:text-emerald-400 font-bold">{money(p.total_retail_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 2. EXPIRED & NEAR-EXPIRY REPORT */}
      {currentReport === 'expired_stock' && (
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 uppercase font-semibold text-[11px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Medicine</th>
                  <th className="py-2.5 px-3">Manufacturer</th>
                  <th className="py-2.5 px-3">Batch #</th>
                  <th className="py-2.5 px-3">Expiry Date</th>
                  <th className="py-2.5 px-3 text-center">Loc</th>
                  <th className="py-2.5 px-3 text-center">Remaining Quantity</th>
                  <th className="py-2.5 px-3 text-right">Loss Valuation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {reportData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400 dark:text-slate-500">
                      No expired or near-expiry batches found for selected window.
                    </td>
                  </tr>
                ) : (
                  reportData.map((b, idx) => (
                    <tr
                      key={idx}
                      className={`transition-colors ${
                        idx % 2 === 0
                          ? 'bg-transparent'
                          : 'bg-slate-50/70 dark:bg-[#162032]/40'
                      } hover:bg-teal-500/5 dark:hover:bg-teal-500/10`}
                    >
                      <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                        {b.product_name}
                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 ml-2">({b.p_code})</span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{b.company_name}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-700 dark:text-slate-200">{b.batch_no}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-rose-600 dark:text-rose-400">{b.expiry_date}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-amber-600 dark:text-amber-400 font-semibold">{b.location_rack || '-'}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-slate-900 dark:text-white">{b.quantity_boxes} Boxes</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                        {money(Number(b.loss_valuation))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. FINISHED (ZERO) STOCK REPORT */}
      {currentReport === 'finished_stock' && (
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 uppercase font-semibold text-[11px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">C-Code</th>
                  <th className="py-2.5 px-3">P-Code</th>
                  <th className="py-2.5 px-3">Medicine Name</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Rack</th>
                  <th className="py-2.5 px-3">Company</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {reportData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400 dark:text-slate-500">
                      No finished products. All active catalog items have stock.
                    </td>
                  </tr>
                ) : (
                  reportData.map((p, idx) => (
                    <tr
                      key={p.id}
                      className={`transition-colors ${
                        idx % 2 === 0
                          ? 'bg-transparent'
                          : 'bg-slate-50/70 dark:bg-[#162032]/40'
                      } hover:bg-teal-500/5 dark:hover:bg-teal-500/10`}
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-teal-600 dark:text-teal-400">{p.c_code}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">{p.p_code}</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{p.name}</td>
                      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{p.unit_type}</td>
                      <td className="py-2.5 px-3 font-mono text-amber-600 dark:text-amber-400 font-semibold">{p.location_rack || '-'}</td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{p.company_name}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="badge-danger">
                          OUT OF STOCK
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. PROFIT & LOSS SUMMARY */}
      {currentReport === 'pnl_summary' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-xs">
            <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">Total Net Sales Revenue</span>
            <div className="text-3xl font-extrabold font-mono text-slate-900 dark:text-white mt-2">
              {money(Number(pnlSummary?.total_revenue || 0))}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{pnlSummary?.total_invoices || 0} invoice(s)</div>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-xs">
            <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">Cost of Goods Sold (COGS)</span>
            <div className="text-3xl font-extrabold font-mono text-amber-600 dark:text-amber-400 mt-2">
              {money(Number(pnlSummary?.total_cost_of_goods || 0))}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Based on purchase trade price</div>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-xs">
            <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">Gross Profit</span>
            <div className="text-3xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400 mt-2">
              {money(Number(pnlSummary?.gross_profit || 0))}
            </div>
            <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Revenue minus COGS & bill discounts</div>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-xs">
            <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">Profit Margin</span>
            <div className="text-3xl font-extrabold font-mono text-teal-600 dark:text-teal-400 mt-2">
              {pnlSummary?.total_revenue > 0
                ? ((pnlSummary.gross_profit / pnlSummary.total_revenue) * 100).toFixed(1)
                : '0.0'}%
            </div>
            <div className="text-xs text-teal-600 dark:text-teal-400 mt-1">Overall operational margin</div>
          </div>
        </div>
      )}

      {/* 5. INVOICE-WISE PROFIT & LOSS */}
      {currentReport === 'invoice_pnl' && (
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 uppercase font-semibold text-[11px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Invoice #</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Customer</th>
                  <th className="py-2.5 px-3 text-right">Sale Amount</th>
                  <th className="py-2.5 px-3 text-right">Cost (COGS)</th>
                  <th className="py-2.5 px-3 text-right">Gross Profit</th>
                  <th className="py-2.5 px-3 text-right">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {reportData.map((inv, idx) => (
                  <tr
                    key={inv.id}
                    className={`transition-colors ${
                      idx % 2 === 0
                        ? 'bg-transparent'
                        : 'bg-slate-50/70 dark:bg-[#162032]/40'
                    } hover:bg-teal-500/5 dark:hover:bg-teal-500/10`}
                  >
                    <td className="py-2.5 px-3 font-mono font-bold text-teal-600 dark:text-teal-400">{inv.invoice_no}</td>
                    <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{new Date(inv.sale_date).toLocaleDateString()}</td>
                    <td className="py-2.5 px-3 text-slate-900 dark:text-white font-medium">{inv.customer_name}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-900 dark:text-white">{money(Number(inv.sale_amount))}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-amber-600 dark:text-amber-400">{money(Number(inv.total_cost))}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">{money(Number(inv.net_profit))}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-teal-600 dark:text-teal-400">{inv.profit_margin_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. PRODUCT-WISE SALES */}
      {currentReport === 'product_sales' && (
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 uppercase font-semibold text-[11px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">C-Code</th>
                  <th className="py-2.5 px-3">P-Code</th>
                  <th className="py-2.5 px-3">Medicine Name</th>
                  <th className="py-2.5 px-3 text-center">Total Sold Qty</th>
                  <th className="py-2.5 px-3 text-right">Total Revenue</th>
                  <th className="py-2.5 px-3 text-right">Total Cost</th>
                  <th className="py-2.5 px-3 text-right">Profit Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {reportData.map((item, idx) => (
                  <tr
                    key={idx}
                    className={`transition-colors ${
                      idx % 2 === 0
                        ? 'bg-transparent'
                        : 'bg-slate-50/70 dark:bg-[#162032]/40'
                      } hover:bg-teal-500/5 dark:hover:bg-teal-500/10`}
                  >
                    <td className="py-2.5 px-3 font-mono font-bold text-teal-600 dark:text-teal-400">{item.c_code}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">{item.p_code}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{item.product_name}</td>
                    <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-900 dark:text-white">{item.total_quantity_sold}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-900 dark:text-white">{money(Number(item.total_sales_amount))}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-amber-600 dark:text-amber-400">{money(Number(item.total_cost_amount))}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">{money(Number(item.gross_profit))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 7. COMPANY-WISE SALES */}
      {currentReport === 'company_sales' && (
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 uppercase font-semibold text-[11px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Company Code</th>
                  <th className="py-2.5 px-3">Company Name</th>
                  <th className="py-2.5 px-3 text-center">Invoices Count</th>
                  <th className="py-2.5 px-3 text-center">Total Units Sold</th>
                  <th className="py-2.5 px-3 text-right">Total Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {reportData.map((c, idx) => (
                  <tr
                    key={idx}
                    className={`transition-colors ${
                      idx % 2 === 0
                        ? 'bg-transparent'
                        : 'bg-slate-50/70 dark:bg-[#162032]/40'
                    } hover:bg-teal-500/5 dark:hover:bg-teal-500/10`}
                  >
                    <td className="py-2.5 px-3 font-mono font-bold text-teal-600 dark:text-teal-400">{c.company_code}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{c.company_name}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-600 dark:text-slate-300">{c.invoice_count}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-600 dark:text-slate-300">{c.total_units_sold}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">{money(Number(c.total_revenue))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
