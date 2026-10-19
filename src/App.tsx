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
import { api } from './services/apiService';
import { SystemSettings } from './types';
import { Modal } from './components/common/Modal';
import { CheckCircle2, Download, Database } from 'lucide-react';
import { useThemeStore } from './store/useThemeStore';
import { useAuthStore } from './store/useAuthStore';
import { LoginModal } from './components/auth/LoginModal';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<TabType>('pos');
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [quickNotification, setQuickNotification] = useState<string | null>(null);
  const { theme } = useThemeStore();
  const { user, isAuthenticated, hasModuleAccess } = useAuthStore();

  // Quick Shift closing modal
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const [quickOpeningCash, setQuickOpeningCash] = useState(5000);
  const [quickActualCash, setQuickActualCash] = useState(5000);
  const [quickNotes, setQuickNotes] = useState('Shift closed from POS Header');

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

  const handleExecuteQuickClosing = async () => {
    try {
      const res = await api.recordDailyClosing({
        closing_date: new Date().toISOString().split('T')[0],
        opening_cash: quickOpeningCash,
        total_sales_cash: 0,
        total_sales_card: 0,
        total_sales_credit: 0,
        total_returns: 0,
        total_purchases_paid: 0,
        expenses_total: 0,
        expected_cash: quickOpeningCash,
        actual_cash: quickActualCash,
        difference: quickActualCash - quickOpeningCash,
        notes: quickNotes
      });
      if (res.success) {
        setIsClosingModalOpen(false);
        setQuickNotification('Shift closed and auto backup recorded.');
        setTimeout(() => setQuickNotification(null), 5000);
      }
    } catch (e: any) {
      alert('Closing error: ' + e.message);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-100 dark:bg-[#0b0f19] text-slate-800 dark:text-slate-100 overflow-hidden font-sans transition-colors duration-200">
      {/* Top Application Header */}
      <Header
        onQuickBackup={handleQuickBackup}
        onOpenClosing={() => setIsClosingModalOpen(true)}
      />

      {/* Quick Notification Toast */}
      {quickNotification && (
        <div className="absolute top-18 right-6 z-50 flex items-center space-x-2 px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-semibold shadow-2xl animate-bounce backdrop-blur-md">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>{quickNotification}</span>
        </div>
      )}

      {/* Main Workspace: Sidebar + Dynamic Module Page */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar currentTab={currentTab} onSelectTab={setCurrentTab} />

        <main className="flex-1 flex flex-col overflow-hidden bg-slate-100/60 dark:bg-[#0b0f19] relative transition-colors duration-200">
          {currentTab === 'dashboard' && (
            <Dashboard settings={settings} onNavigateTab={setCurrentTab} />
          )}
          {currentTab === 'pos' && (
            <PosPage settings={settings} />
          )}
          {currentTab === 'sales' && (
            <SalesHistoryPage settings={settings} />
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

      {/* Shift Closing Quick Modal */}
      <Modal
        isOpen={isClosingModalOpen}
        onClose={() => setIsClosingModalOpen(false)}
        title="Shift / Daily Register Closing"
        maxWidth="max-w-md"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-400">
            Reconcile your physical cash drawer with POS totals. Submitting will close the shift and take an automated SQLite database backup.
          </p>

          <div className="space-y-3 bg-slate-50 dark:bg-[#0e1424] p-4 rounded-xl border border-slate-200 dark:border-slate-800/80">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Opening Cash ({settings?.currency_symbol || 'Rs.'})</label>
              <input
                type="number"
                value={quickOpeningCash}
                onChange={(e) => setQuickOpeningCash(parseFloat(e.target.value) || 0)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Actual Physical Cash ({settings?.currency_symbol || 'Rs.'})</label>
              <input
                type="number"
                value={quickActualCash}
                onChange={(e) => setQuickActualCash(parseFloat(e.target.value) || 0)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white font-mono font-bold focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Closing Remarks</label>
              <input
                type="text"
                value={quickNotes}
                onChange={(e) => setQuickNotes(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              onClick={() => setIsClosingModalOpen(false)}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleExecuteQuickClosing}
              className="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl shadow-md transition-all active:scale-95"
            >
              Confirm Shift Close
            </button>
          </div>
        </div>
      </Modal>

      {/* Persistent Authentication Modal */}
      <LoginModal isOpen={!isAuthenticated || !user} />
    </div>
  );
};
