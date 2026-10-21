import React, { useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Package,
  Truck,
  BarChart3,
  Database,
  Settings,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  Timer
} from 'lucide-react';

export type TabType = 'dashboard' | 'pos' | 'sales' | 'shifts' | 'masters' | 'purchases' | 'khata' | 'reports' | 'utilities' | 'settings';

interface SidebarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab }) => {
  const [collapsed, setCollapsed] = useState(false);
  const { hasModuleAccess } = useAuthStore();

  interface NavItem {
    id: TabType;
    label: string;
    icon: any;
    hotkey?: string;
    badge?: string;
  }

  const cashierNavItems: NavItem[] = [
    { id: 'pos', label: 'Counter Sale (POS)', icon: ShoppingCart, hotkey: 'F1', badge: 'Active' },
    { id: 'sales', label: 'Sales & Returns', icon: Receipt },
    { id: 'khata', label: 'Customer Credit (Khata)', icon: CreditCard },
  ];

  const adminNavItems: NavItem[] = [
    { id: 'dashboard', label: 'Executive Dashboard', icon: LayoutDashboard },
    { id: 'shifts', label: 'Shift Management', icon: Timer, badge: 'Admin' },
    { id: 'masters', label: 'Medicines & Masters', icon: Package },
    { id: 'purchases', label: 'Purchases & Stock', icon: Truck },
    { id: 'reports', label: 'Reports & P&L', icon: BarChart3 },
    { id: 'utilities', label: 'Backup & Recovery', icon: Database },
    { id: 'settings', label: 'System Settings', icon: Settings },
  ];

  const visibleCashierItems = cashierNavItems.filter(item => hasModuleAccess(item.id));
  const visibleAdminItems = adminNavItems.filter(item => hasModuleAccess(item.id));

  const renderNavButton = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = currentTab === item.id;
    return (
      <button
        key={item.id}
        onClick={() => onSelectTab(item.id)}
        title={collapsed ? item.label : undefined}
        className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2.5'} rounded-xl text-xs font-semibold transition-all cursor-pointer ${
          isActive
            ? 'bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800/80 shadow-xs'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-[#111827]'
        }`}
      >
        <div className="flex items-center space-x-2.5 truncate">
          <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400 dark:text-slate-500'}`} />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </div>
        {!collapsed && item.hotkey && (
          <span className={`px-1.5 py-0.5 text-[9px] font-mono rounded font-bold ${
            isActive
              ? 'bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-200'
              : 'bg-slate-200 dark:bg-[#162032] text-slate-500 dark:text-slate-400'
          }`}>
            {item.hotkey}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside className={`${collapsed ? 'w-18' : 'w-64'} bg-slate-50/95 dark:bg-[#0a0e17]/95 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between select-none transition-all duration-200`}>
      <div className="py-3 px-2.5 space-y-3 overflow-y-auto">
        {/* Module Header / Toggle */}
        <div className="flex items-center justify-between px-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {!collapsed && <span>Pharmacy Nav</span>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#162032] transition-colors ml-auto cursor-pointer"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Section 1: Daily Operations */}
        {visibleCashierItems.length > 0 && (
          <div className="space-y-1">
            {!collapsed && (
              <div className="px-2 pt-1 pb-1 text-[9px] font-black uppercase tracking-wider text-teal-700 dark:text-teal-400/80">
                Daily Operations
              </div>
            )}
            {visibleCashierItems.map(renderNavButton)}
          </div>
        )}

        {/* Section 2: Management & Admin */}
        {visibleAdminItems.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-slate-200/80 dark:border-slate-800/80">
            {!collapsed && (
              <div className="px-2 pt-2 pb-1 text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Management & Admin
              </div>
            )}
            {visibleAdminItems.map(renderNavButton)}
          </div>
        )}
      </div>

      {/* System Status footer widget */}
      {!collapsed && (
        <div className="p-3.5 m-2.5 rounded-xl bg-slate-200/50 dark:bg-[#111827]/70 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
          <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-300">
            <span>Engine Status</span>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          </div>
          <div className="text-[11px] space-y-0.5 text-slate-500 dark:text-slate-400">
            <div className="flex justify-between">
              <span>Storage:</span>
              <span className="font-mono text-slate-700 dark:text-slate-300">SQLite (WAL)</span>
            </div>
            <div className="flex justify-between">
              <span>Mode:</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">100% Offline</span>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
