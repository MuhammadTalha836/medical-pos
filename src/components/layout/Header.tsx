import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { useThemeStore } from '../../store/useThemeStore';
import { useShiftStore } from '../../store/useShiftStore';
import { ProfileModal } from '../auth/ProfileModal';
import { AppLogo } from '../common/AppLogo';
import { api } from '../../services/apiService';
import { LicenseStatus, SystemSettings } from '../../types';
import { SupportModal } from './SupportModal';
import { developerInfoFor } from '../../../shared/developerProfile';
import {
  Clock,
  Database,
  Calendar,
  UserCheck,
  Sun,
  Moon,
  LogOut,
  LifeBuoy,
} from 'lucide-react';
import { useShiftElapsed } from '../../hooks/useShiftElapsed';

interface HeaderProps {
  settings: SystemSettings | null;
  onQuickBackup?: () => void;
  onOpenClosing?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ settings, onQuickBackup, onOpenClosing }) => {
  const { user, hasPermission, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const { activeShift, setStartModalOpen, setClosingModalOpen } = useShiftStore();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const hasSupportInfo = developerInfoFor(settings, 'about').length > 0;
  const [time, setTime] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [license, setLicense] = useState<LicenseStatus | null>(null);

  // Demo countdown for the Admin and Developer (rechecked hourly)
  useEffect(() => {
    if (!user || (user.role !== 'admin' && user.role !== 'developer')) {
      setLicense(null);
      return;
    }
    const check = () => api.getLicenseStatus().then(setLicense).catch(err => console.warn('License status unavailable:', err));
    check();
    const interval = setInterval(check, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.id, user?.role]);
  const showDemoBadge = license?.mode === 'demo' && license.daysLeft !== null && (license.daysLeft <= 7 || user?.role === 'developer');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
      setDate(now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsedFormatted = useShiftElapsed(activeShift?.start_time);

  return (
    <header className="h-16 bg-white/95 dark:bg-[#111827]/95 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-5 select-none z-20 transition-colors duration-150">
      {/* Brand & Status */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-3">
          <AppLogo className="w-10 h-10" />
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-lg tracking-tight text-slate-900 dark:text-white">
                PharmaCare Pro
              </span>
              <span className="badge-info">
                POS v1.0
              </span>
              {showDemoBadge && (
                <span
                  className={license?.expired || (license?.daysLeft ?? 99) <= 3 ? 'badge-danger' : 'badge-warning'}
                  title={license?.expiresAt ? `Demo ends ${new Date(license.expiresAt).toLocaleString()}` : undefined}
                >
                  {license!.expired ? 'Demo ended' : `Demo: ${license!.daysLeft} day${license!.daysLeft === 1 ? '' : 's'} left`}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">100% Offline POS</p>
          </div>
        </div>

      </div>

      {/* Clock, Theme Toggle & Action Controls */}
      <div className="flex items-center space-x-3 sm:space-x-4">
        {/* Date & Time */}
        <div className="hidden lg:flex items-center space-x-3 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-xs">
          <div className="flex items-center space-x-1.5">
            <Calendar className="w-4 h-4 text-slate-400 dark:text-slate-400" />
            <span>{date}</span>
          </div>
          <div className="h-3 w-px bg-slate-200 dark:bg-slate-700"></div>
          <div className="flex items-center space-x-1.5 font-mono font-medium text-teal-700 dark:text-teal-300">
            <Clock className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <span>{time}</span>
          </div>
        </div>

        {/* Eye-Friendly Theme Toggle (Sun/Moon) */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Eye-Friendly Light Mode' : 'Switch to Night-Shift Dark Mode'}
          className="btn-secondary btn-sm"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Light</span>
            </>
          ) : (
            <>
              <Moon className="w-4 h-4 text-teal-600" />
              <span className="hidden sm:inline">Dark</span>
            </>
          )}
        </button>

        {/* Developer support contact (shown once the Developer fills it in) */}
        {hasSupportInfo && (
          <button
            onClick={() => setIsSupportOpen(true)}
            title="Software support contact"
            className="btn-secondary btn-sm"
          >
            <LifeBuoy className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <span className="hidden sm:inline">Support</span>
          </button>
        )}

        {/* Quick Backup button (Protected by permission) */}
        {onQuickBackup && hasPermission('can_backup') && (
          <button
            onClick={onQuickBackup}
            title="Instant Backup"
            className="btn-secondary btn-sm"
          >
            <Database className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <span className="hidden sm:inline">Backup</span>
          </button>
        )}

        {/* Cashier Shift Status Indicator & Actions */}
        {hasPermission('can_shift_close') && (
          activeShift ? (
            <button
              onClick={() => {
                if (onOpenClosing) onOpenClosing();
                else setClosingModalOpen(true);
              }}
              title={`Active Shift: ${activeShift.shift_no} (Started by ${activeShift.user_name}). Click to reconcile and close shift.`}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/50 border border-emerald-300 dark:border-emerald-800/80 rounded-xl transition-colors shadow-xs"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-mono">{activeShift.shift_no}</span>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">({elapsedFormatted})</span>
              <span className="text-2xs bg-emerald-200/60 dark:bg-emerald-800/60 px-1.5 py-0.5 rounded-sm font-bold ml-1">
                Close Shift
              </span>
            </button>
          ) : (
            <button
              onClick={() => setStartModalOpen(true)}
              title="No shift currently active. Click to start a new cashier shift."
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/50 dark:hover:bg-amber-900/50 border border-amber-300 dark:border-amber-800/80 rounded-xl transition-colors shadow-xs animate-pulse"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              <span>Shift Inactive</span>
              <span className="text-2xs bg-amber-200/60 dark:bg-amber-800/60 px-1.5 py-0.5 rounded-sm font-bold ml-1">
                Start Shift
              </span>
            </button>
          )
        )}

        {/* User Info & Self-Profile Trigger */}
        <div className="flex items-center space-x-2 pl-2 border-l border-slate-200 dark:border-slate-800">
          <button
            onClick={() => setIsProfileOpen(true)}
            title="Edit My Profile & Change Password"
            className="flex items-center space-x-2.5 p-1 rounded-xl hover:bg-slate-100 dark:hover:bg-[#162032] transition-colors text-left group"
          >
            <div className="w-8 h-8 rounded-full bg-teal-50 dark:bg-teal-950/50 border border-teal-500/40 flex items-center justify-center text-teal-600 dark:text-teal-300 text-xs font-bold shadow-xs">
              <UserCheck className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            </div>
            <div className="hidden sm:block">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight group-hover:text-teal-600 dark:group-hover:text-teal-400">
                {user?.full_name || 'Pharmacist'}
              </div>
              <div className="text-2xs font-bold text-teal-600 dark:text-teal-400">
                {user?.role_display || user?.role || 'Admin'}
              </div>
            </div>
          </button>

          {/* Logout / Switch Shift Button */}
          <button
            onClick={logout}
            title="Sign Out / Switch Shift"
            className="p-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 dark:bg-[#162032] dark:hover:bg-rose-950/60 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Self-Profile Modal */}
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />
      <SupportModal isOpen={isSupportOpen} onClose={() => setIsSupportOpen(false)} settings={settings} />
    </header>
  );
};
