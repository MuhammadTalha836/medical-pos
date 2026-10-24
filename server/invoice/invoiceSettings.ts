import type { PrismaClient } from '../generated/prisma/client';
import { normalizePaperSize, normalizeTemplate } from '../../shared/invoice';

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
