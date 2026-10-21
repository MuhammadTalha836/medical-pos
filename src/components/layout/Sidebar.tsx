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

  const allNavItems = [
    { id: 'pos' as TabType, label: 'Counter Sale (POS)', icon: ShoppingCart, hotkey: 'F1', badge: 'Active' },
    { id: 'dashboard' as TabType, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'sales' as TabType, label: 'Sales & Returns', icon: Receipt },
    { id: 'shifts' as TabType, label: 'Shift Management', icon: Timer, badge: 'Admin' },
    { id: 'khata' as TabType, label: 'Customer Credit (Khata)', icon: CreditCard },
    { id: 'masters' as TabType, label: 'Masters & Coding', icon: Package },
    { id: 'purchases' as TabType, label: 'Purchases & Stock', icon: Truck },
    { id: 'reports' as TabType, label: 'Reports & P&L', icon: BarChart3 },
    { id: 'utilities' as TabType, label: 'Backup & Utilities', icon: Database },
    { id: 'settings' as TabType, label: 'System Settings', icon: Settings },
  ];

  const visibleNavItems = allNavItems.filter(item => hasModuleAccess(item.id));

  return (
    <aside className={`${collapsed ? 'w-18' : 'w-64'} bg-slate-50/95 dark:bg-[#0a0e17]/95 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between select-none transition-all duration-200`}>
      <div className="py-3 px-2.5 space-y-1">
        {/* Module Header / Toggle */}
        <div className="flex items-center justify-between px-2 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {!collapsed && <span>Core Modules</span>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#162032] transition-colors ml-auto"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2.5'} rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800/80 shadow-sm shadow-teal-500/10'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-[#111827]'
              }`}
            >
              <div className="flex items-center space-x-3">
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400 dark:text-slate-400'}`} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </div>
              {!collapsed && item.hotkey && (
                <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded font-semibold ${
                  isActive
                    ? 'bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-200'
                    : 'bg-slate-200 dark:bg-[#162032] text-slate-500 dark:text-slate-400'
                }`}>
                  {item.hotkey}
                </span>
              )}
            </button>
          );
        })}
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
