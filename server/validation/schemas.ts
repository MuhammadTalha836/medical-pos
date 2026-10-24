import { z } from 'zod';
import type { Response } from 'express';

// Request-body schemas for the API. Messages match the API's existing error contract.
// Objects are loose: unknown keys pass through untouched and handlers keep their domain rules.

const requiredText = (message: string) => z.string({ error: message }).trim().min(1, { error: message });

// Scalars accepted as setting values (stored as strings in system_settings)
const settingValue = z.union([z.string(), z.number(), z.boolean()], {
  error: 'Setting values must be text, numbers or true/false'
});

const demoDays = z.coerce.number({ error: 'Demo days must be a whole number from 1 to 365' }).int({ error: 'Demo days must be a whole number from 1 to 365' }).min(1, { error: 'Demo days must be a whole number from 1 to 365' }).max(365, { error: 'Demo days must be a whole number from 1 to 365' });

const licenseChoice = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('full') }),
  z.strictObject({ mode: z.literal('demo'), demoDays })
], { error: "License mode must be 'demo' or 'full'" });

// Developer license changes: switch to Full, start a fresh demo of N days, or extend the current demo
export const licenseUpdateSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('full') }),
  z.strictObject({ action: z.literal('demo'), demoDays }),
  z.strictObject({ action: z.literal('extend'), demoDays })
], { error: "License action must be 'full', 'demo' or 'extend'" });

const totpCode = (message: string) => z.coerce.string({ error: message }).trim().regex(/^\d{6}$/, { error: message });

export const setupUnlockSchema = z.looseObject({
  code: totpCode('Enter the 6-digit code from the developer authenticator app')
});

const passwordRule = z.string({ error: 'Admin password must be at least 8 characters' }).min(8, { error: 'Admin password must be at least 8 characters' }).max(128, { error: 'Admin password is too long' });

export const setupCompleteSchema = z.strictObject({
  setupToken: requiredText('Setup session expired. Unlock the wizard with the developer code again.'),
  storeName: requiredText('Store name is required').pipe(z.string().max(80, { error: 'Store name cannot exceed 80 characters' })),
  storeAddress: requiredText('Store address is required').pipe(z.string().max(160, { error: 'Store address cannot exceed 160 characters' })),
  admin: z.strictObject({
    fullName: requiredText('Admin full name is required'),
    username: requiredText('Admin username is required').pipe(
      z.string().regex(/^[a-zA-Z0-9._-]{3,32}$/, { error: 'Admin username must be 3-32 letters, digits, dot, dash or underscore' })
    ),
    password: passwordRule
  }, { error: 'Admin account details are required' }),
  backup: z.strictObject({
    dir: z.string().trim().max(400).optional(),
    frequency: z.string({ error: 'Backup frequency is required' }),
    time: z.string({ error: 'Backup time must use 24-hour HH:MM format' }),
    weeklyDay: z.coerce.number().int().min(0).max(6).optional()
  }, { error: 'Backup settings are required' }),
  adminPermissions: z.record(z.string(), z.boolean(), { error: 'Admin permissions must be true/false values' }),
  policies: z.strictObject({
    allow_admin_create_cashier: z.boolean(),
    allow_admin_create_admin: z.boolean(),
    allow_admin_edit_store_identity: z.boolean(),
    allow_admin_hide_store_identity: z.boolean()
  }, { error: 'Admin policy toggles are required' }),
  license: licenseChoice
});

const developerLoginMessage = 'Developer email and 6-digit TOTP code are required';
export const developerLoginSchema = z.looseObject({
  email: requiredText(developerLoginMessage),
  code: z.coerce.string({ error: developerLoginMessage }).trim().min(1, { error: developerLoginMessage })
});

const loginMessage = 'Username and password are required';
export const loginSchema = z.looseObject({
  username: requiredText(loginMessage),
  password: z.string({ error: loginMessage }).min(1, { error: loginMessage })
});

const createUserMessage = 'All fields are required';
export const createUserSchema = z.looseObject({
  username: requiredText(createUserMessage),
  password: z.string({ error: createUserMessage }).min(1, { error: createUserMessage }),
  full_name: requiredText(createUserMessage),
  role: z.string().optional()
});

export const updateUserSchema = z.looseObject({
  username: z.string().trim().min(1, { error: 'Username cannot be empty' }).optional(),
  full_name: z.string().trim().min(1, { error: 'Full name cannot be empty' }).optional(),
  role: z.string().optional(),
  status: z.enum(['active', 'inactive'], { error: "Status must be 'active' or 'inactive'" }).optional(),
  password: z.string().optional()
});

export const settingsSchema = z.record(z.string(), settingValue);

export const developerSettingsSchema = z.record(z.string(), settingValue);

export const backupScheduleSchema = z.strictObject(
  { backup_scheduled_time: z.string({ error: 'Backup time must use 24-hour HH:MM format' }) },
  { error: 'Only backup_scheduled_time can be changed here. Backup frequency is managed by the Developer.' }
);

export const shiftReopenSchema = z.looseObject({
  reason: requiredText('A mandatory reason is required for reopening a closed shift.')
});

const saleItemSchema = z.looseObject({
  product_id: z.coerce.number({ error: 'Each sale item needs a valid product_id' }).int().positive({ error: 'Each sale item needs a valid product_id' }),
  quantity: z.coerce.number({ error: 'Each sale item needs a quantity greater than zero' }).positive({ error: 'Each sale item needs a quantity greater than zero' })
});

export const createSaleSchema = z.looseObject({
  items: z.array(saleItemSchema, { error: 'Sale must include at least one item.' }).min(1, { error: 'Sale must include at least one item.' })
});

/**
 * Validates a request body. On failure sends 400 with the first issue's message and returns null,
 * so handlers keep their existing check order (e.g. setup lock 403 before input 400).
 */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown, res: Response): z.infer<T> | null {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0]?.message || 'Invalid request body' });
    return null;
  }
  return result.data;
}
