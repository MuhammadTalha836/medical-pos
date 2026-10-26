/** WhatsApp messages (receipts, khata reminders, supplier orders) opened through a wa.me link. Pure, shared by the UI and the specs. */
import { normalizePhone } from './customers';
import { localDateString } from './dates';
import { composeWhatsAppCredit } from './developerProfile';

export const WHATSAPP_TEMPLATE_MAX = 1000;
/** Receipt lines listed before "...and N more", so the link stays short */
export const WHATSAPP_ITEMS_MAX = 25;

export const DEFAULT_WHATSAPP_RECEIPT_TEMPLATE =
  'Assalam-o-Alaikum {customer},\n\nThank you for shopping at {store}.\nInvoice: {invoice_no}\nDate: {date}\n\n{items}\n\nTotal: {total} ({payment})\n\nGet well soon!\n{store} {store_phone}';

export const DEFAULT_WHATSAPP_REMINDER_TEMPLATE =
  'Assalam-o-Alaikum {customer},\n\nThis is a reminder from {store}. Your khata balance is {balance}.\nPlease clear it at your convenience.\n\nThank you!\n{store} {store_phone}';

export const WHATSAPP_TEMPLATE_KEYS = ['whatsapp_receipt_template', 'whatsapp_reminder_template'] as const;

export const RECEIPT_PLACEHOLDERS = ['customer', 'store', 'store_phone', 'invoice_no', 'date', 'items', 'total', 'payment'] as const;
export const REMINDER_PLACEHOLDERS = ['customer', 'store', 'store_phone', 'balance'] as const;

/**
 * International number for wa.me (digits only), or null when it cannot be one.
 * Pakistani forms 0300-1234567, +92 300 1234567, 0092..., 3001234567 all become 923001234567;
 * other numbers of 11-15 digits that do not start with 0 are kept as written.
 */
export function whatsappPhone(phone: string | null | undefined): string | null {
  let digits = normalizePhone(phone);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^03\d{9}$/.test(digits)) digits = `92${digits.slice(1)}`;
  else if (/^3\d{9}$/.test(digits)) digits = `92${digits}`;
  if (digits.startsWith('0') || digits.length < 11 || digits.length > 15) return null;
  return digits;
}

/** Shown under a phone field when the number is valid for the khata but cannot get WhatsApp messages */
export function whatsappPhoneWarning(phone: string | null | undefined): string | null {
  if (!normalizePhone(phone) || whatsappPhone(phone)) return null;
  return 'This number cannot get WhatsApp messages. A mobile number has 11 digits, e.g. 0300-1234567.';
}

/** Replaces {placeholder} values; unknown placeholders stay as written */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) => (key in vars ? vars[key] : match));
}

/** The wa.me link that opens WhatsApp with the message typed in, or null without a usable phone */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const number = whatsappPhone(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

type Money = (amount: number) => string;

interface MessageSettings {
  store_name?: string | null;
  store_phone?: string | null;
  whatsapp_receipt_template?: string | null;
  whatsapp_reminder_template?: string | null;
  /** Developer Profile → WhatsApp (the line staff cannot remove) */
  developer_info_whatsapp?: string | null;
  developer_whatsapp_lead?: string | null;
}

interface ReceiptSale {
  invoice_no: string;
  customer_name?: string | null;
  sale_date: string;
  net_total: number;
  payment_type: string;
  store_name_snapshot?: string | null;
  items?: { product_name: string; quantity: number; is_loose: number | boolean; net_amount: number }[];
  /** Loyalty (M10): set on sales to a member */
  loyalty_plan_name?: string | null;
  points_earned?: number;
  points_balance?: number | null;
}

/** "Points earned: 12, balance: 340" for a member's sale, or '' */
function pointsLine(sale: ReceiptSale): string {
  if (!sale.loyalty_plan_name || sale.points_balance === null || sale.points_balance === undefined) return '';
  return `\n\nLoyalty points earned: ${sale.points_earned ?? 0}. Your balance: ${sale.points_balance} points.`;
}

const tidy = (text: string) => text.replace(/[ \t]+$/gm, '').trim();

/** Adds the developer's line (Developer Profile → WhatsApp) under a message; staff cannot turn it off */
export function withDeveloperCredit(text: string, settings: object | null | undefined): string {
  const credit = composeWhatsAppCredit(settings);
  return credit ? `${text}\n\n${credit}` : text;
}

const showDate = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : `${localDateString(d)} ${d.toTimeString().slice(0, 5)}`;
};

/** One line per medicine, capped at WHATSAPP_ITEMS_MAX */
export function receiptItemLines(items: ReceiptSale['items'], money: Money): string {
  const list = items ?? [];
  const lines = list
    .slice(0, WHATSAPP_ITEMS_MAX)
    .map(i => `- ${i.product_name} x ${i.quantity} ${i.is_loose ? 'Unit' : 'Bx'} = ${money(Number(i.net_amount) || 0)}`);
  if (list.length > WHATSAPP_ITEMS_MAX) lines.push(`...and ${list.length - WHATSAPP_ITEMS_MAX} more`);
  return lines.join('\n');
}

export function receiptMessage(sale: ReceiptSale, settings: MessageSettings | null | undefined, money: Money): string {
  const template = settings?.whatsapp_receipt_template?.trim() || DEFAULT_WHATSAPP_RECEIPT_TEMPLATE;
  return withDeveloperCredit(tidy(fillTemplate(template, {
    customer: sale.customer_name?.trim() || 'Customer',
    store: sale.store_name_snapshot || settings?.store_name || '',
    store_phone: settings?.store_phone || '',
    invoice_no: sale.invoice_no,
    date: showDate(sale.sale_date),
    items: receiptItemLines(sale.items, money),
    total: money(Number(sale.net_total) || 0),
    payment: sale.payment_type
  }) + pointsLine(sale)), settings);
}

export function reminderMessage(
  customer: { name: string; current_balance: number },
  settings: MessageSettings | null | undefined,
  money: Money
): string {
  const template = settings?.whatsapp_reminder_template?.trim() || DEFAULT_WHATSAPP_REMINDER_TEMPLATE;
  return withDeveloperCredit(tidy(fillTemplate(template, {
    customer: customer.name,
    store: settings?.store_name || '',
    store_phone: settings?.store_phone || '',
    balance: money(Number(customer.current_balance) || 0)
  })), settings);
}
