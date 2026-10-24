import { create } from 'zustand';
import { CashierShift, ShiftSummary } from '../types';
import { api } from '../services/apiService';

interface ShiftState {
  activeShift: CashierShift | null;
  activeSummary: ShiftSummary | null;
  loading: boolean;
  isStartModalOpen: boolean;
  isClosingModalOpen: boolean;

  setStartModalOpen: (open: boolean) => void;
  setClosingModalOpen: (open: boolean) => void;

  fetchActiveShift: (userId: number) => Promise<CashierShift | null>;
  startShift: (userId: number, userName: string, openingCash: number, notes?: string) => Promise<CashierShift>;
  fetchShiftSummary: (shiftId: number) => Promise<ShiftSummary | null>;
  closeShift: (shiftId: number, actualCash: number, notes?: string, userId?: number, userName?: string) => Promise<{ success: boolean; shift: CashierShift; backup?: any }>;
  reopenShift: (shiftId: number, adminId: number, adminName: string, reason: string) => Promise<void>;
  correctShift: (shiftId: number, adminId: number, adminName: string, correctedCash: number, reason: string) => Promise<void>;
  clearActiveShift: () => void;
}

export const useShiftStore = create<ShiftState>((set, get) => ({
  activeShift: null,
  activeSummary: null,
  loading: false,
  isStartModalOpen: false,
  isClosingModalOpen: false,

  setStartModalOpen: (open) => set({ isStartModalOpen: open }),
  setClosingModalOpen: (open) => set({ isClosingModalOpen: open }),

  fetchActiveShift: async (userId: number) => {
    try {
      set({ loading: true });
      const res = await api.getActiveShift(userId);
      set({
        activeShift: res.activeShift,
        activeSummary: res.summary || null,
        loading: false
      });
      return res.activeShift;
    } catch (err) {
      console.error('Failed to fetch active shift:', err);
      set({ activeShift: null, activeSummary: null, loading: false });
      return null;
    }
  },

  startShift: async (userId: number, userName: string, openingCash: number, notes?: string) => {
    set({ loading: true });
    try {
      const res = await api.startShift({
        user_id: userId,
        user_name: userName,
        opening_cash: openingCash,
        notes
      });
      set({
        activeShift: res.shift,
        isStartModalOpen: false,
        loading: false
      });
      // Fetch fresh summary right after start
      await get().fetchShiftSummary(res.shift.id);
      return res.shift;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  fetchShiftSummary: async (shiftId: number) => {
    try {
      const res = await api.getShiftSummary(shiftId);
      // A late response must not bring back a shift that was closed (or replaced) meanwhile
      if (res.shift.status === 'open' && get().activeShift?.id === shiftId) {
        set({
          activeShift: res.shift,
          activeSummary: res.summary
        });
      }
      return res.summary;
    } catch (err) {
      console.error('Failed to fetch shift summary:', err);
      return null;
    }
  },

  closeShift: async (shiftId: number, actualCash: number, notes?: string, userId?: number, userName?: string) => {
    set({ loading: true });
    try {
      const res = await api.closeShift(shiftId, {
        actual_cash: actualCash,
        notes,
        user_id: userId,
        user_name: userName
      });
      set({
        activeShift: null,
        activeSummary: null,
        loading: false
      });
      return res;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  reopenShift: async (shiftId: number, adminId: number, adminName: string, reason: string) => {
    set({ loading: true });
    try {
      const res = await api.reopenShiftByAdmin(shiftId, {
        admin_id: adminId,
        admin_name: adminName,
        reason
      });
      set({
        activeShift: res.shift,
        loading: false
      });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  correctShift: async (shiftId: number, adminId: number, adminName: string, correctedCash: number, reason: string) => {
    set({ loading: true });
    try {
      const res = await api.correctShiftByAdmin(shiftId, {
        admin_id: adminId,
        admin_name: adminName,
        corrected_closing_cash: correctedCash,
        reason
      });
      if (get().activeShift?.id === shiftId) {
        set({ activeShift: res.shift });
      }
      set({ loading: false });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  clearActiveShift: () => set({ activeShift: null, activeSummary: null })
}));
