import type { PrismaClient } from '@prisma/client';

// Phase 3: invoices are thermal-only (58mm / 80mm rolls) with three built-in designs.
export const INVOICE_TEMPLATES = ['classic', 'compact', 'detailed'] as const;
export const INVOICE_PAPER_SIZES = ['58mm', '80mm'] as const;

export type InvoiceTemplate = (typeof INVOICE_TEMPLATES)[number];
export type InvoicePaperSize = (typeof INVOICE_PAPER_SIZES)[number];

export const DEFAULT_INVOICE_TEMPLATE: InvoiceTemplate = 'classic';
export const DEFAULT_INVOICE_PAPER_SIZE: InvoicePaperSize = '80mm';
export const DEFAULT_DEVELOPER_FOOTER = 'Software maintained by System Developer';
export const FOOTER_MAX_LENGTH = 500;

export function isValidTemplate(value: unknown): value is InvoiceTemplate {
  return typeof value === 'string' && (INVOICE_TEMPLATES as readonly string[]).includes(value);
}

export function isValidPaperSize(value: unknown): value is InvoicePaperSize {
  return typeof value === 'string' && (INVOICE_PAPER_SIZES as readonly string[]).includes(value);
}

/**
 * Maps legacy template names (pre-Phase 3 'thermal' / 'standard' A4 sheet) onto the thermal designs.
 */
export function normalizeTemplate(value: unknown): InvoiceTemplate {
  if (isValidTemplate(value)) return value;
  return DEFAULT_INVOICE_TEMPLATE;
}

/**
 * Any non-thermal paper size (A3/A4/A5 or unknown) falls back to the standard 80mm roll.
 */
export function normalizePaperSize(value: unknown): InvoicePaperSize {
  if (isValidPaperSize(value)) return value;
  return DEFAULT_INVOICE_PAPER_SIZE;
}

/**
 * Rewrites stored invoice settings from older installs (A4/A5 paper, 'thermal'/'standard' templates)
 * into valid thermal values. Safe to run on every startup.
 */
export async function migrateLegacyInvoiceSettings(client: PrismaClient): Promise<void> {
  const rows = await client.systemSetting.findMany({
    where: { key: { in: ['default_invoice_template', 'invoice_paper_size', 'paper_width'] } }
  });
  const stored: Record<string, string> = {};
  for (const row of rows) stored[row.key] = row.value;

  // invoice_paper_size is canonical; fall back to legacy paper_width when it is missing
  const template = normalizeTemplate(stored.default_invoice_template);
  const paperSize = normalizePaperSize(stored.invoice_paper_size ?? stored.paper_width);

  const desired: Record<string, string> = {
    default_invoice_template: template,
    invoice_paper_size: paperSize,
    paper_width: paperSize
  };

  const changes = Object.entries(desired).filter(([key, value]) => stored[key] !== value);
  if (changes.length === 0) return;

  await client.$transaction(
    changes.map(([key, value]) =>
      client.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value }
      })
    )
  );
}
