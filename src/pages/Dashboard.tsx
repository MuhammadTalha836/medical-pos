import React, { useState, useEffect } from 'react';
import { api } from '../services/apiService';
import { SystemSettings, SaleInvoice } from '../types';
import { Modal } from '../components/common/Modal';
import { ThermalReceipt } from '../components/pos/ThermalReceipt';
import { useAuthStore } from '../store/useAuthStore';
import {
  DollarSign,
  ShoppingCart,
  AlertTriangle,
  Package,
  Calendar,
  ArrowRight,
  TrendingUp,
  Receipt,
  Eye,
  CheckCircle2,
  Lock
} from 'lucide-react';

interface DashboardProps {
  settings?: SystemSettings | null;
  onNavigateTab: (tab: any) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ settings, onNavigateTab }) => {
  const { hasPermission } = useAuthStore();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<SaleInvoice | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);

  const currency = settings?.currency_symbol || 'Rs.';

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await api.getDashboardStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load dashboard statistics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleViewInvoice = async (invoiceId: number) => {
    try {
      const inv = await api.getSaleById(invoiceId);
      setSelectedInvoice(inv);
      setIsReceiptModalOpen(true);
    } catch (err) {
      console.error('Failed to fetch invoice:', err);
    }
  };

  if (loading && !stats) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-100/60 dark:bg-[#0b0f19] transition-colors duration-200">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Loading Dashboard Data...</span>
        </div>
      </div>
    );
  }

  const todayRevenue = stats?.todaySales?.total_revenue || 0;
  const todayInvoices = stats?.todaySales?.total_invoices || 0;
  const totalProducts = stats?.totalProducts || 0;
  const lowStockCount = stats?.lowStockCount || 0;
  const outOfStockCount = stats?.outOfStockCount || 0;
  const expiredCount = stats?.expiredCount || 0;

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto bg-slate-100/60 dark:bg-[#0b0f19] text-slate-800 dark:text-slate-100 transition-colors duration-200">
      {/* Welcome Banner */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Pharmacy Operations Dashboard</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Live offline metrics & inventory tracking</p>
        </div>

        <button
          onClick={() => onNavigateTab('pos')}
          className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-teal-500/20 active:scale-95 transition-all"
        >
          <ShoppingCart className="w-4 h-4" />
          <span>Launch POS Counter Sale [F1]</span>
          <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </button>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today's Sales */}
        <div className="bg-white dark:bg-[#101726] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4.5 flex flex-col justify-between hover:border-teal-500/40 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Today's Revenue</span>
            <div className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950 border border-teal-200 dark:border-teal-800 text-teal-600 dark:text-teal-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            {hasPermission('can_view_financial_kpis') ? (
              <>
                <div className="text-2xl font-extrabold font-mono text-slate-900 dark:text-white tracking-tight">
                  {currency} {todayRevenue.toFixed(2)}
                </div>
                <div className="flex items-center space-x-1.5 mt-1 text-xs text-teal-600 dark:text-teal-400 font-medium">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>{todayInvoices} completed invoice(s)</span>
                </div>
              </>
            ) : (
              <div className="flex items-center space-x-1.5 text-xs text-slate-400 py-2">
                <Lock className="w-3.5 h-3.5 text-amber-500" />
                <span className="italic">Revenue hidden for Cashier</span>
              </div>
            )}
          </div>
        </div>

        {/* Total Active Products */}
        <div className="bg-white dark:bg-[#101726] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4.5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Products</span>
            <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold font-mono text-slate-900 dark:text-white tracking-tight">
              {totalProducts}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Active in catalog & racks
            </div>
          </div>
        </div>

        {/* Low Stock Warning */}
        <div className="bg-white dark:bg-[#101726] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4.5 flex flex-col justify-between hover:border-amber-500/40 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Low Stock Alert</span>
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold font-mono text-amber-600 dark:text-amber-400 tracking-tight">
              {lowStockCount}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {outOfStockCount > 0 ? (
                <span className="text-rose-600 dark:text-rose-400 font-semibold">{outOfStockCount} completely out of stock</span>
              ) : (
                'Below reorder threshold'
              )}
            </div>
          </div>
        </div>

        {/* Expired Products */}
        <div className="bg-white dark:bg-[#101726] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4.5 flex flex-col justify-between hover:border-rose-500/40 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Expired Batches</span>
            <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold font-mono text-rose-600 dark:text-rose-400 tracking-tight">
              {expiredCount}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Action required for returns
            </div>
          </div>
        </div>
      </div>

      {/* Main Content: Low Stock Priority Table & Recent Invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Low Stock Priority Table */}
        <div className="bg-white dark:bg-[#101726] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">Urgent Stock Reorder Warnings</h2>
            </div>
            <button
              onClick={() => onNavigateTab('purchases')}
              className="text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300 flex items-center space-x-1"
            >
              <span>Create Purchase</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-[#0c1220] text-slate-600 dark:text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2 px-3">Product</th>
                  <th className="py-2 px-3">Rack</th>
                  <th className="py-2 px-3 text-center">In Stock</th>
                  <th className="py-2 px-3 text-center">Alert At</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {stats?.lowStockItems?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-1" />
                      <div>All products are adequately stocked</div>
                    </td>
                  </tr>
                ) : (
                  stats?.lowStockItems?.map((item: any) => (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-850/60 transition-colors">
                      <td className="py-2 px-3">
                        <div className="font-bold text-slate-900 dark:text-white">{item.name}</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{item.c_code} • {item.p_code}</div>
                      </td>
                      <td className="py-2 px-3 text-[11px] font-mono text-amber-600 dark:text-amber-400 font-semibold">
                        {item.location_rack || '-'}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                          item.stock_boxes === 0
                            ? 'bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                            : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                        }`}>
                          {item.stock_boxes} Bx, {item.stock_loose} L
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center font-mono text-slate-600 dark:text-slate-400">
                        {item.min_stock_alert}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => onNavigateTab('purchases')}
                          className="px-2 py-1 text-[10px] font-semibold bg-teal-50 hover:bg-teal-100 dark:bg-teal-950 dark:hover:bg-teal-900 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 rounded-lg transition-colors"
                        >
                          Order
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Sales Transactions */}
        <div className="bg-white dark:bg-[#101726] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Receipt className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">Recent POS Invoices</h2>
            </div>
            <button
              onClick={() => onNavigateTab('sales')}
              className="text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300 flex items-center space-x-1"
            >
              <span>View All History</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-[#0c1220] text-slate-600 dark:text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2 px-3">Invoice #</th>
                  <th className="py-2 px-3">Customer</th>
                  <th className="py-2 px-3 text-center">Type</th>
                  <th className="py-2 px-3 text-right">Amount</th>
                  <th className="py-2 px-3 text-center">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {stats?.recentSales?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      No sales recorded today yet.
                    </td>
                  </tr>
                ) : (
                  stats?.recentSales?.map((sale: any) => (
                    <tr key={sale.id} className="hover:bg-slate-50 dark:hover:bg-slate-850/60 transition-colors">
                      <td className="py-2 px-3 font-mono font-bold text-teal-600 dark:text-teal-300">
                        {sale.invoice_no}
                      </td>
                      <td className="py-2 px-3 text-slate-900 dark:text-white font-medium">
                        {sale.customer_name}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          sale.payment_type === 'Online'
                            ? 'bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                            : sale.payment_type === 'Card'
                            ? 'bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                            : sale.payment_type === 'Credit'
                            ? 'bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                            : 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        }`}>
                          {sale.payment_type}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {currency} {Number(sale.net_total).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => handleViewInvoice(sale.id)}
                          className="p-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
                          title="View & Reprint Receipt"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Invoice Reprint Modal */}
      <Modal
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        title="Thermal Receipt View / Reprint"
        maxWidth="max-w-md"
      >
        {selectedInvoice && (
          <ThermalReceipt
            invoice={selectedInvoice}
            settings={settings}
            onClose={() => setIsReceiptModalOpen(false)}
          />
        )}
      </Modal>
    </div>
  );
};
