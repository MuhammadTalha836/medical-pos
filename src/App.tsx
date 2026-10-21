import React, { useState, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar, TabType } from './components/layout/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { PosPage } from './pages/PosPage';
import { SalesHistoryPage } from './pages/SalesHistoryPage';
import { CustomerKhataPage } from './pages/CustomerKhataPage';
import { MastersPage } from './pages/MastersPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { ReportsPage } from './pages/ReportsPage';
import { UtilitiesPage } from './pages/UtilitiesPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShiftsAdminPage } from './pages/ShiftsAdminPage';
import { api } from './services/apiService';
import { SystemSettings } from './types';
import { CheckCircle2, Download, Database } from 'lucide-react';
import { useThemeStore } from './store/useThemeStore';
import { useAuthStore } from './store/useAuthStore';
import { useShiftStore } from './store/useShiftStore';
import { LoginModal } from './components/auth/LoginModal';
import { ShiftStartModal } from './components/pos/ShiftStartModal';
import { ShiftClosingModal } from './components/pos/ShiftClosingModal';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<TabType>('pos');
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [quickNotification, setQuickNotification] = useState<string | null>(null);
  const { theme } = useThemeStore();
  const { user, isAuthenticated, hasModuleAccess } = useAuthStore();
  const {
    activeShift,
    fetchActiveShift,
    isStartModalOpen,
    setStartModalOpen,
    isClosingModalOpen,
    setClosingModalOpen
  } = useShiftStore();

  const loadSettings = async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  // Sync active cashier shift when user is logged in
  useEffect(() => {
    if (user?.id) {
      fetchActiveShift(user.id);
    }
  }, [user?.id]);

  // Guard tab navigation: If current tab is forbidden for logged-in user, redirect to 'pos'
  useEffect(() => {
    if (user && !hasModuleAccess(currentTab)) {
      setCurrentTab('pos');
    }
  }, [user, currentTab, hasModuleAccess]);

  // Global F1 keybinding to switch to POS
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (e.key === 'F1' && currentTab !== 'pos') {
        e.preventDefault();
        setCurrentTab('pos');
      }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [currentTab]);

  const handleQuickBackup = async () => {
    try {
      setQuickNotification('Creating local backup...');
      const res = await api.createBackup();
      if (res.success) {
        setQuickNotification(`Backup saved: ${res.filename}`);
        setTimeout(() => setQuickNotification(null), 5000);
      }
    } catch (err: any) {
      setQuickNotification('Backup error: ' + err.message);
      setTimeout(() => setQuickNotification(null), 5000);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50 dark:bg-[#0a0e17] text-slate-800 dark:text-slate-100 overflow-hidden font-sans transition-colors duration-200">
      {/* Top Application Header */}
      <Header
        onQuickBackup={handleQuickBackup}
        onOpenClosing={() => setClosingModalOpen(true)}
      />

      {/* Quick Notification Toast */}
      {quickNotification && (
        <div className="absolute top-18 right-6 z-50 flex items-center space-x-2 px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/90 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-semibold shadow-2xl animate-bounce backdrop-blur-md">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>{quickNotification}</span>
        </div>
      )}

      {/* Main Workspace: Sidebar + Dynamic Module Page */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar currentTab={currentTab} onSelectTab={setCurrentTab} />

        <main className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-[#0a0e17] relative transition-colors duration-200">
          {currentTab === 'dashboard' && (
            <Dashboard settings={settings} onNavigateTab={setCurrentTab} />
          )}
          {currentTab === 'pos' && (
            <PosPage settings={settings} />
          )}
          {currentTab === 'sales' && (
            <SalesHistoryPage settings={settings} />
          )}
          {currentTab === 'shifts' && (
            <ShiftsAdminPage settings={settings} />
          )}
          {currentTab === 'khata' && (
            <CustomerKhataPage settings={settings} />
          )}
          {currentTab === 'masters' && (
            <MastersPage settings={settings} />
          )}
          {currentTab === 'purchases' && (
            <PurchasesPage settings={settings} />
          )}
          {currentTab === 'reports' && (
            <ReportsPage settings={settings} />
          )}
          {currentTab === 'utilities' && (
            <UtilitiesPage settings={settings} onRefreshSettings={loadSettings} />
          )}
          {currentTab === 'settings' && (
            <SettingsPage settings={settings} onRefreshSettings={loadSettings} />
          )}
        </main>
      </div>

      {/* Shift Start & Cash Float Declaration Modal */}
      <ShiftStartModal
        isOpen={isStartModalOpen}
        onClose={() => setStartModalOpen(false)}
        currency={settings?.currency_symbol || 'Rs.'}
        onShiftStarted={() => {
          setQuickNotification('Cashier Shift Started Successfully');
          setTimeout(() => setQuickNotification(null), 4000);
        }}
      />

      {/* Shift Reconciliation & Register Closing Modal */}
      <ShiftClosingModal
        isOpen={isClosingModalOpen}
        onClose={() => setClosingModalOpen(false)}
        currency={settings?.currency_symbol || 'Rs.'}
        settings={settings}
        onShiftClosed={() => {
          setQuickNotification('Shift Reconciled & Closed. Auto backup recorded.');
          setTimeout(() => setQuickNotification(null), 5000);
        }}
        onStartNewShiftRequest={() => {
          setClosingModalOpen(false);
          setStartModalOpen(true);
        }}
      />

      {/* Persistent Authentication Modal */}
      <LoginModal isOpen={!isAuthenticated || !user} />
    </div>
  );
};
