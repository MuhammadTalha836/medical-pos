import React, { useState } from 'react';
import { api } from '../../services/apiService';
import { SystemSettings, User, Role } from '../../types';
import { useAuthStore } from '../../store/useAuthStore';
import { Modal } from '../common/Modal';
import { Key, Edit, Trash2, UserPlus, Search } from 'lucide-react';

interface UsersTabProps {
  users: User[];
  roles: Role[];
  settings?: SystemSettings | null;
  onChanged: () => void;
  notify: (message: string) => void;
}

/** Settings → User Logins: staff accounts list with create / edit / delete dialogs. */
export const UsersTab: React.FC<UsersTabProps> = ({ users, roles, settings, onChanged, notify }) => {
  const { user, user: currentUser, updateCurrentUser } = useAuthStore();
  const [userSearch, setUserSearch] = useState('');
  // User Modals
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState('cashier');

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editRole, setEditRole] = useState('cashier');
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [editPassword, setEditPassword] = useState('');


  // User Actions
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword || !newFullName.trim()) {
      alert('Please fill in all user fields');
      return;
    }

    try {
      const res = await api.createUser({
        username: newUsername.trim(),
        password: newPassword,
        full_name: newFullName.trim(),
        role: newRole
      });

      if (res.success) {
        setNewUsername('');
        setNewPassword('');
        setNewFullName('');
        setNewRole('cashier');
        setIsAddUserModalOpen(false);
        notify(`User "${newUsername.trim()}" created successfully.`);
        onChanged();
      }
    } catch (e: any) {
      alert('Failed to create user: ' + e.message);
    }
  };

  const handleOpenEditUser = (user: User) => {
    setEditingUser(user);
    setEditUsername(user.username);
    setEditFullName(user.full_name);
    setEditRole(user.role);
    setEditStatus(user.status);
    setEditPassword('');
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      const payload: any = {
        username: editUsername.trim(),
        full_name: editFullName.trim(),
        role: editRole,
        status: editStatus
      };
      if (editPassword.trim()) {
        payload.password = editPassword.trim();
      }

      const res = await api.updateUser(editingUser.id, payload);
      if (res.success) {
        if (currentUser && currentUser.id === editingUser.id) {
          updateCurrentUser({
            username: editUsername.trim(),
            full_name: editFullName.trim(),
            role: editRole,
            status: editStatus
          });
        }
        setEditingUser(null);
        notify(`User "${editUsername.trim()}" updated successfully.`);
        onChanged();
      }
    } catch (e: any) {
      alert('Failed to update user: ' + e.message);
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (user.id === 1 || user.username === 'admin') {
      alert('Primary Administrator account cannot be deleted.');
      return;
    }

    if (!confirm(`Are you sure you want to delete user "${user.username}" (${user.full_name})? This action cannot be undone.`)) {
      return;
    }

    try {
      const res = await api.deleteUser(user.id);
      if (res.success) {
        notify(`User "${user.username}" deleted successfully.`);
        onChanged();
      }
    } catch (e: any) {
      alert('Failed to delete user: ' + e.message);
    }
  };

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.full_name.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.role.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search users by name, username, or role..."
                  className="w-full bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500"
                />
              </div>

              <button
                onClick={() => setIsAddUserModalOpen(true)}
                className="btn-save flex items-center space-x-1.5 px-4 py-2 text-white font-bold text-xs rounded-xl shadow-md transition-all"
              >
                <UserPlus className="w-4 h-4" />
                <span>Create New Staff Account</span>
              </button>
            </div>

            {/* Users Table */}
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-surface-inset-dark text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Username / ID</th>
                    <th className="py-3 px-4">Staff Member</th>
                    <th className="py-3 px-4 text-center">Assigned Role</th>
                    <th className="py-3 px-4 text-center">Account Status</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {filteredUsers.map((u) => {
                    const isCurrent = currentUser?.id === u.id;
                    const isAdminId1 = u.id === 1 || u.username === 'admin';

                    return (
                      <tr key={u.id} className="hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors">
                        <td className="py-3 px-4 font-mono">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-teal-600 dark:text-teal-400">@{u.username}</span>
                            {isCurrent && (
                              <span className="text-[10px] bg-teal-500/10 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300 font-bold px-1.5 py-0.5 rounded-sm border border-teal-500/30">
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">ID #{u.id}</div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-white text-sm">{u.full_name}</div>
                          {u.created_at && (
                            <div className="text-[10px] text-slate-400">Added: {new Date(u.created_at).toLocaleDateString()}</div>
                          )}
                        </td>

                        <td className="py-3 px-4 text-center">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            u.role === 'admin'
                              ? 'badge-danger'
                              : u.role === 'pharmacist'
                              ? 'badge-info'
                              : 'badge-success'
                          }`}>
                            {u.role_display || u.role}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            u.status === 'active'
                              ? 'badge-success'
                              : 'bg-slate-100 dark:bg-surface-inset-dark text-slate-500 border-slate-300 dark:border-slate-800'
                          }`}>
                            {u.status.toUpperCase()}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center space-x-1.5">
                            {u.role === 'developer' && user?.role !== 'developer' ? (
                              <span className="text-[11px] font-mono text-purple-600 dark:text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-sm border border-purple-500/20">
                                Developer Locked
                              </span>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleOpenEditUser(u)}
                                  className="btn-edit px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1"
                                  title="Edit User Login & Reset Password"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                  <span>Edit / Reset</span>
                                </button>

                                {!isAdminId1 && u.role !== 'developer' && (
                                  <button
                                    onClick={() => handleDeleteUser(u)}
                                    className="btn-delete p-1.5 rounded-lg transition-colors"
                                    title="Delete Account"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

      {/* MODAL: ADD USER */}
      <Modal
        isOpen={isAddUserModalOpen}
        onClose={() => setIsAddUserModalOpen(false)}
        title="Create New Staff Member Account"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Username (Login ID)</label>
            <input
              type="text"
              required
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="e.g. cashier2"
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Full Name</label>
            <input
              type="text"
              required
              value={newFullName}
              onChange={(e) => setNewFullName(e.target.value)}
              placeholder="e.g. Muhammad Ali"
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Initial Password</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Assigned Role</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            >
              {roles
                .filter(r => {
                  if (r.name === 'developer') return false;
                  if (user?.role !== 'developer') {
                    if (r.name === 'admin' && settings?.allow_admin_create_admin !== 'true') return false;
                    if (r.name === 'cashier' && settings?.allow_admin_create_cashier === 'false') return false;
                  }
                  return true;
                })
                .map(r => (
                  <option key={r.id} value={r.name}>
                    {r.display_name} ({r.name})
                  </option>
                ))}
            </select>
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsAddUserModalOpen(false)}
              className="btn-cancel px-4 py-2 rounded-xl font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-save px-5 py-2 text-white font-bold rounded-xl shadow-md transition-all"
            >
              Create Account
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: EDIT USER & RESET PASSWORD */}
      <Modal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        title={`Edit Staff Account: @${editingUser?.username}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleSaveEditUser} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Username (Login ID)</label>
            <input
              type="text"
              required
              value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Full Name</label>
            <input
              type="text"
              required
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Assigned Role</label>
            <select
              value={editRole}
              onChange={(e) => setEditRole(e.target.value)}
              disabled={editingUser?.id === 1}
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
            >
              {roles.map(r => (
                <option key={r.id} value={r.name}>
                  {r.display_name} ({r.name})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Account Status</label>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as any)}
              disabled={editingUser?.id === 1}
              className="w-full bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
            >
              <option value="active">Active (Access Allowed)</option>
              <option value="inactive">Inactive (Access Suspended)</option>
            </select>
          </div>

          <div className="p-3 bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/30 dark:border-amber-800/60 rounded-xl space-y-1.5">
            <div className="flex items-center space-x-1.5 text-amber-700 dark:text-amber-300 font-bold">
              <Key className="w-3.5 h-3.5" />
              <span>Reset Password (Optional)</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Leave this blank if you do not wish to change this staff member's password.
            </p>
            <input
              type="password"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
              placeholder="Enter new password to overwrite"
              className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setEditingUser(null)}
              className="btn-cancel px-4 py-2 rounded-xl font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-save px-5 py-2 text-white font-bold rounded-xl shadow-md transition-all"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
};
