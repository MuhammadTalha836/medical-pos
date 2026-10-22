import React, { useState } from 'react';
import { api } from '../../services/apiService';
import { useAuthStore } from '../../store/useAuthStore';
import {
  ShieldCheck,
  Building,
  MapPin,
  Mail,
  Lock,
  QrCode,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ArrowRight,
  RefreshCw,
  Sparkles
} from 'lucide-react';

interface SetupWizardModalProps {
  isOpen: boolean;
  onCompleted: () => void;
}

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({ isOpen, onCompleted }) => {
  const { setUser } = useAuthStore();
  const [step, setStep] = useState<1 | 2>(1);

  // Form State
  const [storeName, setStoreName] = useState('AL-SHIFA PHARMACY & WELLNESS');
  const [storeAddress, setStoreAddress] = useState('Suite #12-14, Health Plaza, Main Commercial Ave');
  const [developerEmail, setDeveloperEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('admin123');

  // TOTP Session State
  const [totpSecret, setTotpSecret] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [verificationCode, setVerificationCode] = useState('');

  // UI State
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  if (!isOpen) return null;

  // Step 1: Initialize Setup and generate TOTP QR Code
  const handleProceedToTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!developerEmail || !developerEmail.includes('@')) {
      setErrorMsg('Please enter a valid Developer Email address.');
      return;
    }
    if (!adminPassword || adminPassword.length < 6) {
      setErrorMsg('Initial Administrator password must be at least 6 characters.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await api.initializeSetup({
        developerEmail: developerEmail.trim().toLowerCase(),
        storeName: storeName.trim(),
        storeAddress: storeAddress.trim()
      });

      if (res.success) {
        setTotpSecret(res.secret);
        setQrCodeUrl(res.qrCodeDataUrl);
        setTempToken(res.tempToken);
        setStep(2);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize setup. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify TOTP Code and lock setup
  const handleVerifyAndFinalize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode || verificationCode.trim().length !== 6) {
      setErrorMsg('Please enter the complete 6-digit code from your authenticator app.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await api.verifySetup({
        developerEmail: developerEmail.trim().toLowerCase(),
        code: verificationCode.trim(),
        tempToken,
        storeName: storeName.trim(),
        storeAddress: storeAddress.trim(),
        adminPassword: adminPassword.trim()
      });

      if (res.success && res.user) {
        setUser(res.user);
        onCompleted();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid verification code. Please check your authenticator app and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopySecret = () => {
    if (!totpSecret) return;
    navigator.clipboard.writeText(totpSecret);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 3000);
  };

  const formatKeyChunks = (key: string) => {
    return key.match(/.{1,4}/g)?.join(' ') || key;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-xl animate-fade-in select-none">
      <div className="w-full max-w-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header Ribbon */}
        <div className="p-6 bg-gradient-to-r from-teal-600 via-teal-700 to-emerald-700 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner">
              <ShieldCheck className="w-7 h-7 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-black tracking-tight">PharmaCare Pro</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-400 text-emerald-950 uppercase tracking-wider">
                  Initial Setup Wizard
                </span>
              </div>
              <p className="text-xs text-teal-100 mt-0.5">
                First-time system activation & offline TOTP security binding
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-1.5 text-xs font-semibold px-3 py-1 bg-white/15 rounded-xl border border-white/20">
            <span>Step {step} of 2</span>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 sm:p-8 space-y-6">
          {errorMsg && (
            <div className="flex items-start space-x-2.5 p-3.5 bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-2xl text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {step === 1 ? (
            <form onSubmit={handleProceedToTotp} className="space-y-4">
              <div className="p-3.5 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800/80 rounded-2xl text-xs text-teal-900 dark:text-teal-200 flex items-start space-x-2.5">
                <Sparkles className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0 mt-0.5" />
                <span>
                  Welcome! Set up your pharmacy store identity and configure the <strong>Developer Role</strong>.
                  The Developer email is required for offline time-based two-factor authentication (TOTP).
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Medical Store Name
                </label>
                <div className="relative">
                  <Building className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="e.g. Al-Shifa Pharmacy & Wellness"
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white font-medium focus:border-teal-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Store Address
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={storeAddress}
                    onChange={(e) => setStoreAddress(e.target.value)}
                    placeholder="e.g. Health Plaza, Main Commercial Ave"
                    className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white font-medium focus:border-teal-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    Developer Email <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <input
                      type="email"
                      required
                      autoFocus
                      value={developerEmail}
                      onChange={(e) => setDeveloperEmail(e.target.value)}
                      placeholder="developer@pharmacare.local"
                      className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white font-medium focus:border-teal-500 focus:outline-none"
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Used as the unique identifier for Developer sign-in.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    Initial Admin Password <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <input
                      type="password"
                      required
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:border-teal-500 focus:outline-none"
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Secured locally via bcrypt password hashing.
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-4 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-teal-500/25 flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
              >
                <span>{loading ? 'Initializing Security Keys...' : 'Generate TOTP Authenticator Key'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyAndFinalize} className="space-y-5">
              <div className="flex flex-col sm:flex-row items-center gap-6 p-4 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-2xl">
                {/* QR Code Container */}
                <div className="p-2.5 bg-white rounded-xl shadow-md flex-shrink-0 border border-slate-200">
                  {qrCodeUrl ? (
                    <img
                      src={qrCodeUrl}
                      alt="TOTP QR Code"
                      className="w-36 h-36 object-contain"
                    />
                  ) : (
                    <div className="w-36 h-36 flex items-center justify-center text-slate-400">
                      <QrCode className="w-10 h-10 animate-pulse" />
                    </div>
                  )}
                </div>

                {/* Instructions & Manual Key */}
                <div className="space-y-3 flex-1 text-left">
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center space-x-1.5">
                    <KeyRound className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    <span>Scan with Authenticator App</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Open <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong>, or <strong>Aegis</strong> on your phone and scan this offline QR code.
                  </p>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                      Manual Secret Key (Base32)
                    </span>
                    <div className="flex items-center space-x-2">
                      <code className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-teal-300 font-mono text-[11px] rounded-lg tracking-wider flex-1 select-all break-all">
                        {formatKeyChunks(totpSecret)}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopySecret}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg flex items-center space-x-1 transition-all"
                        title="Copy Key"
                      >
                        {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 6-Digit Code Verification Input */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 text-center">
                  Enter 6-Digit Authenticator Code to Verify Setup
                </label>
                <div className="flex justify-center">
                  <input
                    type="text"
                    required
                    maxLength={6}
                    autoFocus
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="w-56 text-center text-2xl font-mono font-extrabold tracking-widest bg-slate-50 dark:bg-[#0d131f] border-2 border-teal-500/60 rounded-2xl py-2.5 text-teal-700 dark:text-teal-300 focus:outline-none focus:ring-4 focus:ring-teal-500/20"
                  />
                </div>
                <span className="text-[10px] text-center text-slate-400 block mt-1.5">
                  Permanently binds this authenticator to Developer credentials and completes setup.
                </span>
              </div>

              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-all"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || verificationCode.length !== 6}
                  className="flex-1 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-teal-500/25 flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{loading ? 'Verifying & Locking Setup...' : 'Complete & Lock Setup'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
