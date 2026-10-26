import React, { useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { SystemSettings } from '../../types';
import { DeveloperCredit } from '../common/DeveloperCredit';
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Package,
  Truck,
  BarChart3,
  Database,
  Settings,
  Users,
  ChevronLeft,
  ChevronRight,
  Timer,
  Banknote,
  ShieldAlert
} from 'lucide-react';

export type TabType = 'dashboard' | 'pos' | 'sales' | 'shifts' | 'expenses' | 'masters' | 'purchases' | 'khata' | 'reports' | 'utilities' | 'settings' | 'developer';

interface SidebarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  settings: SystemSettings | null;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, settings }) => {
  const [collapsed, setCollapsed] = useState(false);
  const { user, hasModuleAccess } = useAuthStore();

  interface NavItem {
    id: TabType;
    label: string;
    icon: React.ElementType;
    hotkey?: string;
  }

  const cashierNavItems: NavItem[] = [
    { id: 'pos', label: 'New Sale', icon: ShoppingCart, hotkey: 'F1' },
    { id: 'sales', label: 'Sales & Returns', icon: Receipt },
    { id: 'khata', label: 'Customers', icon: Users },
  ];

  const adminNavItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'shifts', label: 'Shifts', icon: Timer },
    { id: 'expenses', label: 'Expenses', icon: Banknote },
    { id: 'masters', label: 'Medicines', icon: Package },
    { id: 'purchases', label: 'Purchases', icon: Truck },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'utilities', label: 'Backup & Recovery', icon: Database },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const developerNavItems: NavItem[] = [
    { id: 'developer', label: 'Developer', icon: ShieldAlert },
  ];

  const visibleCashierItems = cashierNavItems.filter(item => hasModuleAccess(item.id));
  const visibleAdminItems = adminNavItems.filter(item => hasModuleAccess(item.id));

  const renderNavButton = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = currentTab === item.id;
    const isDev = item.id === 'developer';

    return (
      <button
        key={item.id}
        onClick={() => onSelectTab(item.id)}
        title={collapsed ? item.label : undefined}
        className={`w-full flex items-center ${collapsed ? 'justify-center px-2 h-11' : 'justify-between px-3 h-11'} rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
          isActive
            ? isDev
              ? 'bg-purple-50 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300'
              : 'bg-teal-700 text-white dark:bg-teal-600'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-[#111827]'
        }`}
      >
        <div className="flex items-center gap-3 truncate">
          <Icon className={`w-5 h-5 shrink-0 ${
            isActive
              ? isDev
                ? 'text-purple-600 dark:text-purple-400'
                : 'text-white'
              : 'text-slate-500 dark:text-slate-400'
          }`} />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </div>
        {!collapsed && item.hotkey && (
          <span className={`px-1.5 py-0.5 text-2xs font-mono rounded font-bold ${
            isActive
              ? 'bg-white/20 text-white'
              : 'bg-slate-200 dark:bg-[#162032] text-slate-500 dark:text-slate-400'
          }`}>
            {item.hotkey}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside className={`${collapsed ? 'w-18' : 'w-60'} bg-white dark:bg-[#0d131f] border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between select-none transition-all duration-200`}>
      <div className="py-3 px-2.5 space-y-3 overflow-y-auto">
        {/* Module Header / Toggle */}
        <div className="flex items-center justify-between px-2 text-2xs font-semibold text-slate-400 dark:text-slate-500">
          {!collapsed && <span>Menu</span>}
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
              <div className="px-2 pt-1 pb-1 text-2xs font-semibold text-teal-700 dark:text-teal-400/80">
                Daily work
              </div>
            )}
            {visibleCashierItems.map(renderNavButton)}
          </div>
        )}

        {/* Section 2: Management & Admin */}
        {visibleAdminItems.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-slate-200/80 dark:border-slate-800/80">
            {!collapsed && (
              <div className="px-2 pt-2 pb-1 text-2xs font-semibold text-slate-500 dark:text-slate-400">
                Management
              </div>
            )}
            {visibleAdminItems.map(renderNavButton)}
          </div>
        )}

        {/* Section 3: Developer Controls */}
        {user?.role === 'developer' && (
          <div className="space-y-1 pt-1 border-t border-purple-500/20 dark:border-purple-500/20">
            {!collapsed && (
              <div className="px-2 pt-2 pb-1 text-2xs font-semibold text-purple-600 dark:text-purple-400">
                Developer
              </div>
            )}
            {developerNavItems.map(renderNavButton)}
          </div>
        )}
      </div>

      {/* Developer contact (chosen by the Developer) */}
      {!collapsed && <DeveloperCredit settings={settings} placement="sidebar" />}
    </aside>
  );
};
