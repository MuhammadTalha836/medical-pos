import { z } from 'zod';
import type { Response } from 'express';
import { CUSTOMER_NAME_MAX, PHONE_MAX_DIGITS, PHONE_MIN_DIGITS, isValidPhone } from '../../shared/customers';
import { BACKUP_MODES } from '../../shared/backup';
import { PASSWORD_MIN, PASSWORD_MIN_MESSAGE } from '../../shared/passwords';

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
    mode: z.enum(BACKUP_MODES, { error: 'Backup type must be offline, online or both' }).optional(),
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
  password: z.string({ error: createUserMessage }).trim().min(1, { error: createUserMessage }).min(PASSWORD_MIN, { error: PASSWORD_MIN_MESSAGE }),
  full_name: requiredText(createUserMessage),
  role: z.string().optional()
});

export const updateUserSchema = z.looseObject({
  username: z.string().trim().min(1, { error: 'Username cannot be empty' }).optional(),
  full_name: z.string().trim().min(1, { error: 'Full name cannot be empty' }).optional(),
  role: z.string().optional(),
  status: z.enum(['active', 'inactive'], { error: "Status must be 'active' or 'inactive'" }).optional(),
  // Empty means "keep the current password"
  password: z.string().optional().refine(v => !v || v.trim() === '' || v.trim().length >= PASSWORD_MIN, { error: PASSWORD_MIN_MESSAGE })
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
  quantity: z.coerce.number({ error: 'Each sale item needs a quantity greater than zero' })
    .int({ error: 'Quantities must be whole numbers' })
    .positive({ error: 'Each sale item needs a quantity greater than zero' })
});

export const createSaleSchema = z.looseObject({
  items: z.array(saleItemSchema, { error: 'Sale must include at least one item.' }).min(1, { error: 'Sale must include at least one item.' })
});

export const saleReturnSchema = z.looseObject({
  sale_id: z.coerce.number({ error: 'Choose the invoice the items are returned from' }).int().positive({ error: 'Choose the invoice the items are returned from' }),
  reason: z.string().max(300, { error: 'Reason cannot exceed 300 characters' }).nullish(),
  return_items: z.array(z.looseObject({
    product_id: z.coerce.number({ error: 'Each returned item needs a valid product' }).int().positive({ error: 'Each returned item needs a valid product' }),
    is_loose: z.union([z.boolean(), z.number(), z.string()]).optional(),
    quantity: z.coerce.number({ error: 'Each returned item needs a quantity' })
      .int({ error: 'Returned quantities must be whole numbers' })
      .positive({ error: 'Each returned item needs a quantity greater than zero' })
  }), { error: 'No return items specified' }).min(1, { error: 'No return items specified' })
});

const money = (label: string) => z.coerce.number({ error: `${label} must be a number` }).min(0, { error: `${label} cannot be negative` });

export const createPurchaseSchema = z.looseObject({
  company_id: z.coerce.number({ error: 'Choose the supplier' }).int().positive({ error: 'Choose the supplier' }),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Purchase date must be a valid date' }).optional(),
  discount_amount: money('Discount').optional(),
  tax_amount: money('Tax').optional(),
  paid_amount: money('Paid amount').optional(),
  payment_status: z.enum(['Paid', 'Pending', 'Partial'], { error: 'Payment status must be Paid, Pending or Partial' }).optional(),
  items: z.array(z.looseObject({
    product_id: z.coerce.number({ error: 'Each line needs a medicine' }).int().positive({ error: 'Each line needs a medicine' }),
    quantity_boxes: z.coerce.number({ error: 'Each line needs a quantity' }).int({ error: 'Quantities must be whole boxes' }).min(1, { error: 'Each line needs at least 1 box' }),
    bonus_boxes: z.coerce.number().int({ error: 'Bonus must be whole boxes' }).min(0, { error: 'Bonus cannot be negative' }).optional(),
    box_cost_price: money('Cost price'),
    box_retail_price: money('Retail price'),
    discount_pct: z.coerce.number().min(0, { error: 'Discount must be 0-100%' }).max(100, { error: 'Discount must be 0-100%' }).optional()
  }), { error: 'Purchase must have items' }).min(1, { error: 'Purchase must have items' })
});

export const supplierPaymentSchema = z.looseObject({
  amount: z.coerce.number({ error: 'Enter the amount paid' }).positive({ error: 'Enter the amount paid' }),
  payment_method: z.enum(['cash', 'bank', 'cheque', 'online'], { error: 'Payment method must be cash, bank, cheque or online' }).optional(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Payment date must be a valid date' }).optional(),
  reference: z.string().trim().max(60, { error: 'Reference cannot exceed 60 characters' }).nullish(),
  notes: z.string().trim().max(200, { error: 'Notes cannot exceed 200 characters' }).nullish()
});

export const createPurchaseReturnSchema = z.looseObject({
  company_id: z.coerce.number({ error: 'Choose the supplier' }).int().positive({ error: 'Choose the supplier' }),
  purchase_id: z.coerce.number().int().positive().nullish(),
  return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Return date must be a valid date' }).optional(),
  reason: z.string().trim().max(300, { error: 'Reason cannot exceed 300 characters' }).nullish(),
  is_expiry_claim: z.boolean().optional(),
  items: z.array(z.looseObject({
    product_id: z.coerce.number({ error: 'Each line needs a medicine' }).int().positive({ error: 'Each line needs a medicine' }),
    quantity_boxes: z.coerce.number({ error: 'Each line needs a quantity' }).int({ error: 'Return whole boxes only' }).min(1, { error: 'Each line needs at least 1 box' }),
    purchase_item_id: z.coerce.number().int().positive().nullish(),
    batch_no: z.string().trim().max(60, { error: 'Batch number is too long' }).nullish()
  }), { error: 'Add at least one medicine to return.' }).min(1, { error: 'Add at least one medicine to return.' })
});

const customerPhone = z.string({ error: 'Customer phone number is required' }).trim()
  .refine(isValidPhone, { error: `Enter a valid phone number (${PHONE_MIN_DIGITS}-${PHONE_MAX_DIGITS} digits)` });

// Khata customers: a name and a unique phone (the phone tells two customers with the same name apart)
export const customerSchema = z.looseObject({
  name: requiredText('Customer name is required')
    .pipe(z.string().min(2, { error: 'Customer name must be at least 2 characters' }).max(CUSTOMER_NAME_MAX, { error: `Customer name cannot exceed ${CUSTOMER_NAME_MAX} characters` })),
  phone: customerPhone,
  address: z.string().trim().max(200, { error: 'Address cannot exceed 200 characters' }).nullish(),
  credit_limit: z.coerce.number({ error: 'Credit limit must be a number' }).min(0, { error: 'Credit limit cannot be negative' }).optional()
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
