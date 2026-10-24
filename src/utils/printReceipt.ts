/**
 * Receipt printing. Every thermal receipt goes through printReceipt, never window.print() directly:
 * with "Print without dialog" on (a per-computer preference) the receipt goes straight to the chosen
 * printer; otherwise, or outside the desktop app, the normal print dialog opens.
 */

export const PRINT_PREFS_STORAGE_KEY = 'pharmacare_print_prefs';

export interface PrintPrefs {
  /** Print straight to the printer, without the print dialog */
  silent: boolean;
  /** Printer name as the OS knows it; '' is the system default printer */
  printerName: string;
}

export const DEFAULT_PRINT_PREFS: PrintPrefs = { silent: false, printerName: '' };

// Each counter can have its own printer, so this lives on the computer, not in the shared settings
export function loadPrintPrefs(): PrintPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRINT_PREFS_STORAGE_KEY) || 'null');
    return {
      silent: parsed?.silent === true,
      printerName: typeof parsed?.printerName === 'string' ? parsed.printerName : ''
    };
  } catch {
    return { ...DEFAULT_PRINT_PREFS };
  }
}

export function savePrintPrefs(prefs: PrintPrefs): void {
  try {
    localStorage.setItem(PRINT_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable: the preference lasts for this session only
  }
}

// The app's CSS as text, so the receipt looks the same in its own print document
function collectStyles(): string {
  return Array.from(document.styleSheets).map(sheet => {
    try {
      return Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n');
    } catch {
      return '';
    }
  }).join('\n');
}

function receiptDocument(receipt: HTMLElement): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${collectStyles()}</style>
<style>html,body{margin:0;padding:0;background:#fff}#thermal-receipt-printable{box-shadow:none!important;border:0!important;border-radius:0!important;margin:0!important}</style>
</head><body>${receipt.outerHTML}</body></html>`;
}

export interface PrintResult {
  success: boolean;
  error?: string;
}

/**
 * Prints one receipt element (#thermal-receipt-printable). Falls back to the print dialog when
 * silent printing is off, unavailable, or the printer reports an error.
 */
export async function printReceipt(receipt: HTMLElement | null | undefined, prefs: PrintPrefs = loadPrintPrefs()): Promise<PrintResult> {
  const electronAPI = window.electronAPI;
  if (!prefs.silent || !electronAPI || !receipt) {
    window.print();
    return { success: true };
  }

  const paperWidthMm = receipt.dataset.paperSize === '58mm' ? 58 : 80;
  try {
    const result = await electronAPI.printThermal({
      html: receiptDocument(receipt),
      silent: true,
      printerName: prefs.printerName,
      paperWidthMm
    });
    if (result.success) return result;
    window.print();
    return { success: false, error: result.error || 'The printer did not accept the receipt' };
  } catch (err) {
    window.print();
    return { success: false, error: err instanceof Error ? err.message : 'Printing failed' };
  }
}

/** Prints the receipt inside a container (e.g. a receipt modal) */
export function printReceiptIn(container: HTMLElement | null | undefined): Promise<PrintResult> {
  return printReceipt(container?.querySelector<HTMLElement>('#thermal-receipt-printable'));
}
