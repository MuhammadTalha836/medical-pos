import React, { useState } from 'react';
import { api } from '../../services/apiService';
import { Role, RolePermissions } from '../../types';
import { DEFAULT_BLANK_PERMISSIONS, DEFAULT_CASHIER_PERMISSIONS } from '../../../shared/permissions';
import { useAuthStore } from '../../store/useAuthStore';
import { Modal } from '../common/Modal';
import { RolePermissionEditor } from './RolePermissionEditor';
import { Shield, Plus, Trash2, Lock, ShieldCheck } from 'lucide-react';

interface RolesTabProps {
  roles: Role[];
  onChanged: () => void;
  notify: (message: string) => void;
}

/** Settings → Roles: custom staff roles and their permission matrices. */
export const RolesTab: React.FC<RolesTabProps> = ({ roles, onChanged, notify }) => {
  const { user } = useAuthStore();
  // Role Modals
  const [isAddRoleModalOpen, setIsAddRoleModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDisplayName, setNewRoleDisplayName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [newRolePermissions, setNewRolePermissions] = useState<RolePermissions>({ ...DEFAULT_CASHIER_PERMISSIONS });

  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [editRoleDisplayName, setEditRoleDisplayName] = useState('');
  const [editRoleDescription, setEditRoleDescription] = useState('');
  const [editRolePermissions, setEditRolePermissions] = useState<RolePermissions>({ ...DEFAULT_BLANK_PERMISSIONS });


  // Role Actions
  const handleOpenAddRole = () => {
    setNewRoleName('');
    setNewRoleDisplayName('');
    setNewRoleDescription('');
    setNewRolePermissions({ ...DEFAULT_CASHIER_PERMISSIONS });
    setIsAddRoleModalOpen(true);
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const formattedName = newRoleName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!formattedName || !newRoleDisplayName.trim()) {
      alert('Please enter role identifier and display title');
      return;
    }

    try {
      const res = await api.createRole({
        name: formattedName,
        display_name: newRoleDisplayName.trim(),
        description: newRoleDescription.trim(),
        permissions: newRolePermissions
      });

      if (res.success) {
        setIsAddRoleModalOpen(false);
        notify(`Role "${newRoleDisplayName}" created successfully.`);
        onChanged();
      }
    } catch (e: any) {
      alert('Failed to create role: ' + e.message);
    }
  };

  const handleOpenEditRole = (role: Role) => {
    // The Admin's own permission matrix is decided by the Developer (the server enforces this too)
    if ((role.name === 'admin' || role.name === 'developer') && user?.role !== 'developer') {
      alert('Administrator permissions are set by the Developer. Ask the Developer to change them in Developer Settings → Admin Permissions.');
      return;
    }
    setEditingRole(role);
    setEditRoleDisplayName(role.display_name);
    setEditRoleDescription(role.description || '');
    setEditRolePermissions({ ...DEFAULT_BLANK_PERMISSIONS, ...role.permissions });
  };

  const handleSaveEditRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;

    try {
      // If admin, enforce critical permissions
      const perms = { ...editRolePermissions };
      if (editingRole.name === 'admin') {
        perms.settings = true;
        perms.can_manage_roles = true;
        perms.can_manage_users = true;
      }

      const res = await api.updateRole(editingRole.id, {
        display_name: editRoleDisplayName.trim(),
        description: editRoleDescription.trim(),
        permissions: perms
      });

      if (res.success) {
        setEditingRole(null);
        notify(`Role "${editRoleDisplayName}" updated successfully.`);
        onChanged();
      }
    } catch (e: any) {
      alert('Failed to update role: ' + e.message);
    }
  };

  const handleDeleteRole = async (role: Role) => {
    if (role.is_system === 1) {
      alert(`System role "${role.display_name}" is protected and cannot be deleted.`);
      return;
    }

    if ((role.user_count || 0) > 0) {
      alert(`Cannot delete role "${role.display_name}" because ${role.user_count} user(s) are currently assigned to it.`);
      return;
    }

    if (!confirm(`Are you sure you want to permanently delete custom role "${role.display_name}"?`)) {
      return;
    }

    try {
      const res = await api.deleteRole(role.id);
      if (res.success) {
        notify(`Role "${role.display_name}" deleted.`);
        onChanged();
      }
    } catch (e: any) {
      alert('Failed to delete role: ' + e.message);
    }
  };


  return (
    <>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Staff Roles & Permission Matrix</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Grant or restrict page views, button actions, product editing, store reports, and system utilities per staff role
                </p>
              </div>

              <button
                onClick={handleOpenAddRole}
                className="btn-primary text-white"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Staff Role</span>
              </button>
            </div>

            {/* Roles Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {roles.map((r) => {
                const isSys = r.is_system === 1;

                return (
                  <div
                    key={r.id}
                    className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          {isSys ? (
                            <Lock className="w-4 h-4 text-amber-500" />
                          ) : (
                            <ShieldCheck className="w-4 h-4 text-teal-500" />
                          )}
                          <h3 className="font-bold text-slate-900 dark:text-white text-base">{r.display_name}</h3>
                        </div>
                        <span className={`text-2xs font-bold px-2 py-0.5 rounded-full border ${
                          isSys
                            ? 'badge-warning'
                            : 'badge-info'
                        }`}>
                          {isSys ? 'System Role' : 'Custom'}
                        </span>
                      </div>

                      <div className="text-xs font-mono text-slate-400">
                        Identifier: <span className="text-teal-600 dark:text-teal-400 font-bold">{r.name}</span>
                      </div>

                      <p className="text-xs text-slate-500 dark:text-slate-400 min-h-[36px]">
                        {r.description || 'No description provided.'}
                      </p>

                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>Assigned Users:</span>
                        <span className="font-mono font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-surface-inset-dark px-2 py-0.5 rounded-sm border border-slate-200 dark:border-slate-800">
                          {r.user_count || 0}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 flex items-center space-x-2">
                      <button
                        onClick={() => handleOpenEditRole(r)}
                        className="btn-secondary flex-1"
                      >
                        <Shield className="w-4 h-4" />
                        <span>Configure Permissions</span>
                      </button>

                      {!isSys && (
                        <button
                          onClick={() => handleDeleteRole(r)}
                          disabled={(r.user_count || 0) > 0}
                          title={(r.user_count || 0) > 0 ? 'Cannot delete role with assigned users' : 'Delete Role'}
                          className="btn-danger p-2 disabled:opacity-40"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

      {/* MODAL: CREATE CUSTOM ROLE */}
      <Modal
        isOpen={isAddRoleModalOpen}
        onClose={() => setIsAddRoleModalOpen(false)}
        title="Create Custom Staff Role"
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleCreateRole} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                Role System Key (Lowercase, unique)
              </label>
              <input
                type="text"
                required
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="e.g. junior_cashier or stock_manager"
                className="field-input w-full font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                Display Title
              </label>
              <input
                type="text"
                required
                value={newRoleDisplayName}
                onChange={(e) => setNewRoleDisplayName(e.target.value)}
                placeholder="e.g. Junior Cashier"
                className="field-input w-full font-bold"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                Role Description
              </label>
              <input
                type="text"
                value={newRoleDescription}
                onChange={(e) => setNewRoleDescription(e.target.value)}
                placeholder="Brief summary of duties and responsibilities"
                className="field-input w-full"
              />
            </div>
          </div>

          <RolePermissionEditor
            title="Configure Permission Matrix"
            permissions={newRolePermissions}
            onChange={setNewRolePermissions}
          />

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsAddRoleModalOpen(false)}
              className="btn-secondary font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary text-white"
            >
              Save Custom Role
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: EDIT ROLE & PERMISSIONS MATRIX */}
      <Modal
        isOpen={!!editingRole}
        onClose={() => setEditingRole(null)}
        title={`Configure Role Permissions: ${editingRole?.display_name}`}
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleSaveEditRole} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                Display Title
              </label>
              <input
                type="text"
                required
                value={editRoleDisplayName}
                onChange={(e) => setEditRoleDisplayName(e.target.value)}
                className="field-input w-full font-bold"
              />
            </div>

            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                System Identifier
              </label>
              <input
                type="text"
                disabled
                value={editingRole?.name || ''}
                className="field-input w-full font-mono"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                Role Description
              </label>
              <input
                type="text"
                value={editRoleDescription}
                onChange={(e) => setEditRoleDescription(e.target.value)}
                placeholder="Brief summary of duties and responsibilities"
                className="field-input w-full"
              />
            </div>
          </div>

          <RolePermissionEditor
            title="Interactive Permission Checkboxes"
            permissions={editRolePermissions}
            onChange={setEditRolePermissions}
            isAdminRole={editingRole?.name === 'admin'}
          />

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setEditingRole(null)}
              className="btn-secondary font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary text-white"
            >
              Save Permissions
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
};
