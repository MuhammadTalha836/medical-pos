import React, { useState, useEffect } from 'react';
import { api } from '../../services/apiService';
import { useAuthStore } from '../../store/useAuthStore';
import { Modal } from '../common/Modal';
import {
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Shield
} from 'lucide-react';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose }) => {
  const { user, updateCurrentUser } = useAuthStore();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setUsername(user.username || '');
      setFullName(user.full_name || '');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [user, isOpen]);

  if (!isOpen || !user) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !fullName.trim()) {
      setErrorMsg('Username and Full Name are required.');
      return;
    }

    if (newPassword) {
      if (!currentPassword) {
        setErrorMsg('Please enter your current password to set a new password.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setErrorMsg('New password and confirmation do not match.');
        return;
      }
      if (newPassword.length < 4) {
        setErrorMsg('New password must be at least 4 characters.');
        return;
      }
    }

    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await api.updateProfile({
        userId: user.id,
        username: username.trim(),
        full_name: fullName.trim(),
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined
      });

      if (res.success && res.user) {
        updateCurrentUser(res.user);
        setSuccessMsg(res.message || 'Credentials updated successfully.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="My Account & Login Credentials"
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
        {errorMsg && (
          <div className="flex items-center space-x-2 p-3 bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-xl">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center space-x-2 p-3 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Current Role Badge */}
        <div className="p-3 bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <div className="text-slate-500 dark:text-slate-400 text-[10px] uppercase font-semibold">Assigned Role</div>
              <div className="font-bold text-slate-900 dark:text-white capitalize">{user.role_display || user.role}</div>
            </div>
          </div>
          <span className="badge-success">
            Account Active
          </span>
        </div>

        <div>
          <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
            Display Full Name
          </label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full pos-input"
          />
        </div>

        <div>
          <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
            Sign-in Username
          </label>
          <input
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full pos-input font-mono"
          />
        </div>

        {/* Password Reset Section */}
        <div className="p-3.5 bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center space-x-1.5 text-slate-700 dark:text-slate-300 font-bold">
            <KeyRound className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span>Change Account Password (Optional)</span>
          </div>

          <div>
            <label className="block text-slate-600 dark:text-slate-400 text-[11px] mb-1">
              Current Password (Required only if changing password)
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-white dark:bg-[#162032] border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white font-mono focus:outline-hidden focus:border-teal-500 focus:ring-1 focus:ring-teal-500 text-xs"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-slate-600 dark:text-slate-400 text-[11px] mb-1">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="w-full bg-white dark:bg-[#162032] border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white font-mono focus:outline-hidden focus:border-teal-500 focus:ring-1 focus:ring-teal-500 text-xs"
              />
            </div>
            <div>
              <label className="block text-slate-600 dark:text-slate-400 text-[11px] mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full bg-white dark:bg-[#162032] border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white font-mono focus:outline-hidden focus:border-teal-500 focus:ring-1 focus:ring-teal-500 text-xs"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-cancel"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn-save"
          >
            {loading ? 'Saving...' : 'Update My Credentials'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
