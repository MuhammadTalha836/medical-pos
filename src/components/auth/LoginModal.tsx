import React, { useState } from 'react';
import { api } from '../../services/apiService';
import { useAuthStore } from '../../store/useAuthStore';
import {
  Lock,
  User,
  Activity,
  AlertCircle,
  Eye,
  EyeOff,
  ShieldCheck,
  ArrowRight,
  KeyRound,
  Mail,
  ShieldAlert
} from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onSuccess?: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onSuccess }) => {
  const { setUser } = useAuthStore();
  const [authMode, setAuthMode] = useState<'staff' | 'developer'>('staff');

  // Staff Credentials
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [showPassword, setShowPassword] = useState(false);

  // Developer Credentials
  const [developerEmail, setDeveloperEmail] = useState('');
  const [totpCode, setTotpCode] = useState('');

  // UI State
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setErrorMsg('Please enter both username and password.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await api.login({ username: username.trim(), password });
      if (res.success && res.user) {
        setUser(res.user);
        onSuccess?.();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeveloperLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!developerEmail || !totpCode) {
      setErrorMsg('Please enter both Developer Email and 6-digit TOTP code.');
      return;
    }
    if (totpCode.trim().length !== 6) {
      setErrorMsg('TOTP code must be exactly 6 digits.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await api.developerLogin({
        email: developerEmail.trim().toLowerCase(),
        code: totpCode.trim()
      });
      if (res.success && res.user) {
        setUser(res.user);
        onSuccess?.();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Developer authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSelect = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setErrorMsg(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in select-none">
      <div className="w-full max-w-md bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-teal-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-teal-500/25">
            <Activity className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              PharmaCare<span className="text-teal-600 dark:text-teal-400">Pro</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Secure Offline Sign-In & Authentication
            </p>
          </div>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex p-1 bg-slate-100 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => {
              setAuthMode('staff');
              setErrorMsg(null);
            }}
            className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
              authMode === 'staff'
                ? 'bg-white dark:bg-slate-800 text-teal-600 dark:text-teal-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Staff Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode('developer');
              setErrorMsg(null);
            }}
            className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
              authMode === 'developer'
                ? 'bg-white dark:bg-slate-800 text-teal-600 dark:text-teal-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Developer (TOTP)
          </button>
        </div>

        {errorMsg && (
          <div className="flex items-start space-x-2 p-3 bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-xl text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Staff Login Form */}
        {authMode === 'staff' ? (
          <form onSubmit={handleStaffLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. admin or cashier"
                  className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-900 dark:text-white font-medium focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-10 py-2.5 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-teal-500/25 active:scale-98 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              <span>{loading ? 'Authenticating...' : 'Sign In to Workspace'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            {/* Quick Demo Credentials */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 block mb-2 text-center uppercase tracking-wider">
                Quick Shift Accounts
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleQuickSelect('admin', 'admin123')}
                  className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#162032] dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-left transition-all group"
                >
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-teal-600 dark:group-hover:text-teal-400">
                    Admin
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                    Full Privileges
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickSelect('cashier', 'cash123')}
                  className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#162032] dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-left transition-all group"
                >
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-teal-600 dark:group-hover:text-teal-400">
                    Cashier
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                    Counter Sales Only
                  </div>
                </button>
              </div>
            </div>
          </form>
        ) : (
          /* Developer TOTP Login Form */
          <form onSubmit={handleDeveloperLogin} className="space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl text-[11px] text-amber-800 dark:text-amber-300 flex items-start space-x-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <span>
                Developer sign-in requires offline TOTP authentication via Google Authenticator or compatible app.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Developer Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  required
                  autoFocus
                  value={developerEmail}
                  onChange={(e) => setDeveloperEmail(e.target.value)}
                  placeholder="developer@pharmacare.local"
                  className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-900 dark:text-white font-medium focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                6-Digit Dynamic TOTP Code
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <KeyRound className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2.5 text-sm font-mono font-extrabold tracking-widest text-slate-900 dark:text-teal-300 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all"
                />
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">
                Generated offline on your mobile device.
              </span>
            </div>

            <button
              type="submit"
              disabled={loading || totpCode.length !== 6}
              className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-amber-500/25 active:scale-98 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              <span>{loading ? 'Verifying TOTP...' : 'Verify & Enter as Developer'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        <div className="flex items-center justify-center space-x-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Local SQLite Embedded Authentication • Bcrypt & TOTP</span>
        </div>
      </div>
    </div>
  );
};
