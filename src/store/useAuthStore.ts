import { create } from 'zustand';
import { User, RolePermissions } from '../types';

const DEFAULT_ADMIN_PERMISSIONS: RolePermissions = {
  dashboard: true,
  pos: true,
  sales: true,
  khata: true,
  masters: true,
  purchases: true,
  reports: true,
  utilities: true,
  settings: true,
  can_add_product: true,
  can_edit_product: true,
  can_delete_product: true,
  can_add_company: true,
  can_edit_company: true,
  can_delete_company: true,
  can_delete_invoice: true,
  can_return_sale: true,
  can_view_all_sales: true,
  can_view_financial_kpis: true,
  can_add_purchase: true,
  can_add_customer: true,
  can_receive_payment: true,
  can_edit_customer: true,
  can_delete_customer: true,
  can_discount: true,
  can_backup: true,
  can_restore: true,
  can_shift_close: true,
  can_stock_zero: true,
  can_manage_users: true,
  can_manage_roles: true
};

const DEFAULT_ADMIN_USER: User = {
  id: 1,
  username: 'admin',
  full_name: 'Administrator (Dr. Ahmed)',
  role: 'admin',
  role_display: 'Administrator',
  status: 'active',
  permissions: DEFAULT_ADMIN_PERMISSIONS
};

interface AuthState {
  user: User | null;
  permissions: RolePermissions | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  updateCurrentUser: (updated: Partial<User>) => void;
  logout: () => void;
  hasModuleAccess: (moduleKey: string) => boolean;
  hasPermission: (permissionKey: keyof RolePermissions) => boolean;
}

const getStoredSession = (): { user: User | null; permissions: RolePermissions | null } => {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('pharmacare_user_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.user) {
          return {
            user: parsed.user,
            permissions: parsed.user.permissions || DEFAULT_ADMIN_PERMISSIONS
          };
        }
      }
    } catch {
      // Fallback
    }
  }
  return {
    user: DEFAULT_ADMIN_USER,
    permissions: DEFAULT_ADMIN_PERMISSIONS
  };
};

export const useAuthStore = create<AuthState>((set, get) => {
  const initial = getStoredSession();

  return {
    user: initial.user,
    permissions: initial.permissions,
    isAuthenticated: initial.user !== null,

    setUser: (user) => {
      const perms = user?.permissions || (user?.role === 'admin' ? DEFAULT_ADMIN_PERMISSIONS : null);
      if (typeof window !== 'undefined') {
        if (user) {
          localStorage.setItem('pharmacare_user_session', JSON.stringify({ user: { ...user, permissions: perms } }));
        } else {
          localStorage.removeItem('pharmacare_user_session');
        }
      }
      set({
        user: user ? { ...user, permissions: perms || undefined } : null,
        permissions: perms,
        isAuthenticated: user !== null
      });
    },

    updateCurrentUser: (updated) => {
      const current = get().user;
      if (!current) return;
      const merged = { ...current, ...updated };
      if (typeof window !== 'undefined') {
        localStorage.setItem('pharmacare_user_session', JSON.stringify({ user: merged }));
      }
      set({
        user: merged,
        permissions: merged.permissions || get().permissions
      });
    },

    logout: () => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('pharmacare_user_session');
      }
      set({ user: null, permissions: null, isAuthenticated: false });
    },

    hasModuleAccess: (moduleKey: string) => {
      const { user, permissions } = get();
      if (!user) return false;
      if (user.role === 'admin') return true;
      if (!permissions) return false;
      return Boolean((permissions as any)[moduleKey]);
    },

    hasPermission: (permissionKey: keyof RolePermissions) => {
      const { user, permissions } = get();
      if (!user) return false;
      if (user.role === 'admin') return true;
      if (!permissions) return false;
      return Boolean(permissions[permissionKey]);
    }
  };
});
