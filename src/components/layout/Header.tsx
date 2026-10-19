import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { useThemeStore } from '../../store/useThemeStore';
import { ProfileModal } from '../auth/ProfileModal';
import {
  Activity,
  Clock,
  ShieldCheck,
  Database,
  Calendar,
  UserCheck,
  Sun,
  Moon,
  LogOut
} from 'lucide-react';

interface HeaderProps {
  onQuickBackup?: () => void;
  onOpenClosing?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onQuickBackup, onOpenClosing }) => {
  const { user, hasPermission, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [time, setTime] = useState<string>('');
  const [date, setDate] = useState<string>('');

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

  return (
    <header className="h-16 bg-white/95 dark:bg-[#0f172a]/95 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between px-5 select-none z-20 transition-colors duration-150">
      {/* Brand & Status */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-600 to-emerald-400 flex items-center justify-center shadow-md shadow-teal-500/20">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-lg tracking-tight text-slate-900 dark:text-white">
                PharmaCare<span className="text-teal-600 dark:text-teal-400">Pro</span>
              </span>
              <span className="px-1.5 py-0.5 text-[10px] uppercase font-bold tracking-wider bg-teal-50 dark:bg-teal-950/80 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 rounded">
                POS v1.0
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Offline Desktop Pharmacy System</p>
          </div>
        </div>

        <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden md:block"></div>

        {/* Offline Badge */}
        <div className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>100% Offline (SQLite Local)</span>
        </div>
      </div>

      {/* Clock, Theme Toggle & Action Controls */}
      <div className="flex items-center space-x-3 sm:space-x-4">
        {/* Date & Time */}
        <div className="hidden lg:flex items-center space-x-3 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-slate-600 dark:text-slate-300 text-xs">
          <div className="flex items-center space-x-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
            <span>{date}</span>
          </div>
          <div className="h-3 w-px bg-slate-200 dark:bg-slate-700"></div>
          <div className="flex items-center space-x-1.5 font-mono font-medium text-teal-700 dark:text-teal-300">
            <Clock className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span>{time}</span>
          </div>
        </div>

        {/* Eye-Friendly Theme Toggle (Sun/Moon) */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Eye-Friendly Light Mode' : 'Switch to Night-Shift Dark Mode'}
          className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-4 h-4 text-amber-400 animate-spin-slow" />
              <span className="hidden sm:inline text-xs font-semibold">Light Mode</span>
            </>
          ) : (
            <>
              <Moon className="w-4 h-4 text-teal-600" />
              <span className="hidden sm:inline text-xs font-semibold">Dark Mode</span>
            </>
          )}
        </button>

        {/* Quick Backup button (Protected by permission) */}
        {onQuickBackup && hasPermission('can_backup') && (
          <button
            onClick={onQuickBackup}
            title="Instant Local Database Backup"
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl transition-colors"
          >
            <Database className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span className="hidden sm:inline">Backup DB</span>
          </button>
        )}

        {/* Shift Closing button (Protected by permission) */}
        {onOpenClosing && hasPermission('can_shift_close') && (
          <button
            onClick={onOpenClosing}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800/50 rounded-xl transition-colors"
          >
            <span>Shift Closing</span>
          </button>
        )}

        {/* User Info & Self-Profile Trigger */}
        <div className="flex items-center space-x-2 pl-2 border-l border-slate-200 dark:border-slate-800">
          <button
            onClick={() => setIsProfileOpen(true)}
            title="Edit My Profile & Change Password"
            className="flex items-center space-x-2.5 p-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left group"
          >
            <div className="w-8 h-8 rounded-full bg-teal-50 dark:bg-slate-800 border border-teal-500/40 flex items-center justify-center text-teal-600 dark:text-teal-300 text-xs font-bold shadow-sm">
              <UserCheck className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            </div>
            <div className="hidden sm:block">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight group-hover:text-teal-600 dark:group-hover:text-teal-400">
                {user?.full_name || 'Pharmacist'}
              </div>
              <div className="text-[10px] uppercase font-bold text-teal-600 dark:text-teal-400 tracking-wider">
                {user?.role_display || user?.role || 'Admin'}
              </div>
            </div>
          </button>

          {/* Logout / Switch Shift Button */}
          <button
            onClick={logout}
            title="Sign Out / Switch Shift"
            className="p-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/60 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Self-Profile Modal */}
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />
    </header>
  );
};
