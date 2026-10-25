import React, { useState, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar, TabType } from './components/layout/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { PosPage } from './pages/PosPage';
import { SalesHistoryPage } from './pages/SalesHistoryPage';
import { CustomersPage } from './pages/CustomersPage';
import { MastersPage } from './pages/MastersPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { ReportsPage } from './pages/ReportsPage';
import { UtilitiesPage } from './pages/UtilitiesPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShiftsAdminPage } from './pages/ShiftsAdminPage';
import { DeveloperSettingsPage } from './pages/DeveloperSettingsPage';
import { api } from './services/apiService';
import { SystemSettings } from './types';
import { CheckCircle2 } from 'lucide-react';
import { useAuthStore } from './store/useAuthStore';
import { useShiftStore } from './store/useShiftStore';
import { LoginModal } from './components/auth/LoginModal';
import { SetupWizardModal } from './components/setup/SetupWizardModal';
import { ShiftStartModal } from './components/pos/ShiftStartModal';
import { ShiftClosingModal } from './components/pos/ShiftClosingModal';
import { currencySymbol } from './utils/format';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<TabType>('pos');
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [isSetupCompleted, setIsSetupCompleted] = useState<boolean | null>(null);
  const [quickNotification, setQuickNotification] = useState<string | null>(null);
  const { user, isAuthenticated, hasModuleAccess } = useAuthStore();
  const {
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

  const checkSetupStatus = async () => {
    try {
      const res = await api.getSetupStatus();
      setIsSetupCompleted(res.isSetupCompleted);
    } catch (e) {
      console.error('Failed to check setup status:', e);
      setIsSetupCompleted(true);
    }
  };

  useEffect(() => {
    checkSetupStatus();
    loadSettings();
  }, []);

  // Sync active cashier shift and the full settings once a user is logged in
  // (before login the server only shares the store identity)
  useEffect(() => {
    if (user?.id) {
      fetchActiveShift(user.id);
      loadSettings();
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
      setQuickNotification('Creating backup...');
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
        settings={settings}
        onQuickBackup={handleQuickBackup}
        onOpenClosing={() => setClosingModalOpen(true)}
      />

      {/* Quick Notification Toast */}
      {quickNotification && (
        <div className="absolute top-18 right-6 z-50 flex items-center space-x-2 px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/90 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-semibold shadow-2xl backdrop-blur-md">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>{quickNotification}</span>
        </div>
      )}

      {/* Main Workspace: Sidebar + Dynamic Module Page */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar currentTab={currentTab} onSelectTab={setCurrentTab} settings={settings} />

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
            <CustomersPage settings={settings} />
          )}
          {currentTab === 'masters' && (
            <MastersPage settings={settings} />
          )}
          {currentTab === 'purchases' && (
            <PurchasesPage settings={settings} onRefreshSettings={loadSettings} />
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
          {currentTab === 'developer' && user?.role === 'developer' && (
            <DeveloperSettingsPage onRefreshSettings={loadSettings} />
          )}
        </main>
      </div>

      {/* Shift Start & Cash Float Declaration Modal */}
      <ShiftStartModal
        isOpen={isStartModalOpen}
        onClose={() => setStartModalOpen(false)}
        currency={currencySymbol(settings)}
        onShiftStarted={() => {
          setQuickNotification('Cashier Shift Started Successfully');
          setTimeout(() => setQuickNotification(null), 4000);
        }}
      />

      {/* Shift Reconciliation & Register Closing Modal */}
      <ShiftClosingModal
        isOpen={isClosingModalOpen}
        onClose={() => setClosingModalOpen(false)}
        currency={currencySymbol(settings)}
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

      {/* First-Time Setup Wizard Modal (only if initial setup is pending) */}
      {isSetupCompleted === false && (
        <SetupWizardModal
          isOpen={true}
          onCompleted={() => {
            setIsSetupCompleted(true);
            loadSettings();
            setCurrentTab('developer');
            setQuickNotification('Setup completed and locked. The Admin can now sign in with username and password.');
            setTimeout(() => setQuickNotification(null), 5000);
          }}
        />
      )}

      {/* Persistent Authentication Modal (when setup is done but user is not signed in) */}
      <LoginModal isOpen={isSetupCompleted !== false && (!isAuthenticated || !user)} settings={settings} />
    </div>
  );
};
