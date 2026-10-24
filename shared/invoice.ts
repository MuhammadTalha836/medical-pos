// Invoices are thermal-only (58mm / 80mm rolls) with three built-in designs. Shared by the server
// (validation, startup migration) and the UI, so a stale or legacy value never breaks a print.

export const INVOICE_TEMPLATES = ['classic', 'compact', 'detailed'] as const;
export const INVOICE_PAPER_SIZES = ['58mm', '80mm'] as const;

export type InvoiceTemplate = (typeof INVOICE_TEMPLATES)[number];
export type InvoicePaperSize = (typeof INVOICE_PAPER_SIZES)[number];

const DEFAULT_INVOICE_TEMPLATE: InvoiceTemplate = 'classic';
const DEFAULT_INVOICE_PAPER_SIZE: InvoicePaperSize = '80mm';
export const DEFAULT_DEVELOPER_FOOTER = 'Software maintained by System Developer';
export const FOOTER_MAX_LENGTH = 500;

export const TEMPLATE_LABELS: Record<InvoiceTemplate, string> = {
  classic: 'Classic',
  compact: 'Compact',
  detailed: 'Detailed'
};

export function isValidTemplate(value: unknown): value is InvoiceTemplate {
  return typeof value === 'string' && (INVOICE_TEMPLATES as readonly string[]).includes(value);
}

export function isValidPaperSize(value: unknown): value is InvoicePaperSize {
  return typeof value === 'string' && (INVOICE_PAPER_SIZES as readonly string[]).includes(value);
}

/** Maps legacy template names (pre-Phase 3 'thermal' / 'standard' A4 sheet) onto the thermal designs. */
export function normalizeTemplate(value: unknown): InvoiceTemplate {
  return isValidTemplate(value) ? value : DEFAULT_INVOICE_TEMPLATE;
}

/** Any non-thermal paper size (A3/A4/A5 or unknown) falls back to the standard 80mm roll. */
export function normalizePaperSize(value: unknown): InvoicePaperSize {
  return isValidPaperSize(value) ? value : DEFAULT_INVOICE_PAPER_SIZE;
}
