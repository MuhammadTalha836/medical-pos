import { describe, expect, it } from 'vitest';
import { backupScheduleSchema, createSaleSchema, licenseUpdateSchema, loginSchema, settingsSchema, setupCompleteSchema, setupUnlockSchema } from './schemas';

const firstError = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }) => r.error?.issues[0]?.message;

describe('request schemas (zod)', () => {
  it('login requires username and password with the API message', () => {
    expect(loginSchema.safeParse({ username: 'admin', password: 'x' }).success).toBe(true);
    expect(firstError(loginSchema.safeParse({ username: ' ' }))).toBe('Username and password are required');
  });

  it('setup unlock needs a 6-digit code', () => {
    expect(setupUnlockSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(setupUnlockSchema.safeParse({ code: 123456 }).success).toBe(true);
    expect(firstError(setupUnlockSchema.safeParse({ code: '12a456' }))).toBe('Enter the 6-digit code from the developer authenticator app');
  });

  it('setup completion validates the admin account and license choice', () => {
    const valid = {
      setupToken: 'token',
      storeName: 'Shifa Pharmacy',
      storeAddress: 'Main Road',
      admin: { fullName: 'Owner', username: 'owner', password: 'longenough' },
      backup: { frequency: 'daily', time: '23:00' },
      adminPermissions: { pos: true },
      policies: { allow_admin_create_cashier: true, allow_admin_create_admin: false, allow_admin_edit_store_identity: false, allow_admin_hide_store_identity: false },
      license: { mode: 'demo', demoDays: 14 }
    };
    expect(setupCompleteSchema.safeParse(valid).success).toBe(true);
    expect(firstError(setupCompleteSchema.safeParse({ ...valid, admin: { ...valid.admin, password: 'short' } }))).toBe('Admin password must be at least 8 characters');
    expect(setupCompleteSchema.safeParse({ ...valid, license: { mode: 'demo', demoDays: 0 } }).success).toBe(false);
    expect(setupCompleteSchema.safeParse({ ...valid, license: { mode: 'full' } }).success).toBe(true);
  });

  it('license updates accept only known actions', () => {
    expect(licenseUpdateSchema.safeParse({ action: 'extend', demoDays: 7 }).success).toBe(true);
    expect(licenseUpdateSchema.safeParse({ action: 'full' }).success).toBe(true);
    expect(licenseUpdateSchema.safeParse({ action: 'forever' }).success).toBe(false);
  });

  it('sales need at least one item with a product and positive quantity', () => {
    expect(createSaleSchema.safeParse({ items: [{ product_id: 3, quantity: 2, unit_price: 50 }] }).success).toBe(true);
    expect(firstError(createSaleSchema.safeParse({ items: [] }))).toBe('Sale must include at least one item.');
    expect(createSaleSchema.safeParse({ items: [{ product_id: 3, quantity: 0 }] }).success).toBe(false);
  });

  it('settings values must be scalars', () => {
    expect(settingsSchema.safeParse({ show_store_name: 'true', max_bill_discount_pct: 14 }).success).toBe(true);
    expect(settingsSchema.safeParse({ store_name: { injected: true } }).success).toBe(false);
  });

  it('the Admin backup schedule accepts only the time of day', () => {
    expect(backupScheduleSchema.safeParse({ backup_scheduled_time: '02:15' }).success).toBe(true);
    expect(backupScheduleSchema.safeParse({ backup_scheduled_time: '02:15', backup_frequency: 'off' }).success).toBe(false);
  });
});
