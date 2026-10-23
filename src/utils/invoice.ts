import { InvoicePaperSize, InvoiceTemplateType } from '../types';

// Client mirror of server/invoice/invoiceSettings.ts so a stale or legacy value never breaks a print.
export const INVOICE_TEMPLATES: InvoiceTemplateType[] = ['classic', 'compact', 'detailed'];
export const INVOICE_PAPER_SIZES: InvoicePaperSize[] = ['58mm', '80mm'];
export const DEFAULT_DEVELOPER_FOOTER = 'Software maintained by System Developer';
export const FOOTER_MAX_LENGTH = 500;

export const TEMPLATE_LABELS: Record<InvoiceTemplateType, string> = {
  classic: 'Classic',
  compact: 'Compact',
  detailed: 'Detailed'
};

export function normalizeTemplate(value: unknown): InvoiceTemplateType {
  return INVOICE_TEMPLATES.includes(value as InvoiceTemplateType) ? (value as InvoiceTemplateType) : 'classic';
}

export function normalizePaperSize(value: unknown): InvoicePaperSize {
  return INVOICE_PAPER_SIZES.includes(value as InvoicePaperSize) ? (value as InvoicePaperSize) : '80mm';
}
