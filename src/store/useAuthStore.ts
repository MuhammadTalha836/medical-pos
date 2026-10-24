import { create } from 'zustand';
import { User, RolePermissions } from '../types';
import { DEFAULT_ADMIN_PERMISSIONS } from '../../shared/permissions';
import { api, SESSION_ENDED_EVENT, SESSION_STORAGE_KEY } from '../services/apiService';


interface AuthState {
  user: User | null;
  permissions: RolePermissions | null;
  isAuthenticated: boolean;
  token: string | null;
  // Pass the token returned by a login; omit it to keep the current session's token
  setUser: (user: User | null, token?: string) => void;
  updateCurrentUser: (updated: Partial<User>) => void;
  logout: () => void;
  hasModuleAccess: (moduleKey: string) => boolean;
  hasPermission: (permissionKey: keyof RolePermissions) => boolean;
}

// A stored session needs both the user and the server token; anything else means "logged out"
const getStoredSession = (): { user: User | null; permissions: RolePermissions | null; token: string | null } => {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.user && parsed?.token) {
          return {
            user: parsed.user,
            permissions: parsed.user.permissions || null,
            token: parsed.token
          };
        }
      }
    } catch {
      // Fall through to logged out
    }
  }
  return { user: null, permissions: null, token: null };
};

const storeSession = (user: User | null, token: string | null) => {
  if (typeof window === 'undefined') return;
  if (user && token) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ user, token }));
  } else {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
};

export const useAuthStore = create<AuthState>((set, get) => {
  const initial = getStoredSession();

  // The server ended the session (restart, idle timeout, password reset, demo ended)
  if (typeof window !== 'undefined') {
    window.addEventListener(SESSION_ENDED_EVENT, () => {
      if (get().user) {
        storeSession(null, null);
        set({ user: null, permissions: null, token: null, isAuthenticated: false });
      }
    });
  }

  return {
    user: initial.user,
    permissions: initial.permissions,
    token: initial.token,
    isAuthenticated: initial.user !== null,

    setUser: (user, token) => {
      const perms = user?.permissions || (user?.role === 'admin' || user?.role === 'developer' ? DEFAULT_ADMIN_PERMISSIONS : null);
      const nextToken = user ? token ?? get().token : null;
      const nextUser = user ? { ...user, permissions: perms || undefined } : null;
      storeSession(nextUser, nextToken);
      set({
        user: nextUser,
        permissions: perms,
        token: nextToken,
        isAuthenticated: user !== null && !!nextToken
      });
    },

    updateCurrentUser: (updated) => {
      const current = get().user;
      if (!current) return;
      const merged = { ...current, ...updated };
      storeSession(merged, get().token);
      set({
        user: merged,
        permissions: merged.permissions || get().permissions
      });
    },

    logout: () => {
      // Revoke the server session; the local session is cleared even if the server is unreachable
      if (get().token) api.logout().catch(() => { /* the local session is cleared either way */ });
      storeSession(null, null);
      set({ user: null, permissions: null, token: null, isAuthenticated: false });
    },

    hasModuleAccess: (moduleKey: string) => {
      const { user, permissions } = get();
      if (!user) return false;
      if (moduleKey === 'developer') {
        return user.role === 'developer';
      }
      // The Developer sets the Admin's permissions, so only the Developer bypasses the matrix
      if (user.role === 'developer') return true;
      if (!permissions) return false;
      return Boolean((permissions as any)[moduleKey]);
    },

    hasPermission: (permissionKey: keyof RolePermissions) => {
      const { user, permissions } = get();
      if (!user) return false;
      if (user.role === 'developer') return true;
      if (!permissions) return false;
      return Boolean(permissions[permissionKey]);
    }
  };
});
