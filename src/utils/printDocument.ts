// Prints a page-sized document (statements, lists) instead of a thermal receipt. The app's print CSS only
// shows the receipt, so the element is copied into a hidden frame with its own plain, black-on-white styles.

const DOCUMENT_CSS = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #000; font-size: 12px; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 14px 0 6px; }
  p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
  th { background: #eee; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: #555; }
  .no-print { display: none !important; }
`;

/** Opens the print dialog for one element; resolves after the dialog closes. */
export function printDocument(element: HTMLElement | null | undefined, title: string): Promise<void> {
  if (!element) return Promise.resolve();
  return new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      frame.remove();
      resolve();
      return;
    }
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title></title><style>${DOCUMENT_CSS}</style></head><body></body></html>`);
    doc.close();
    doc.title = title;
    doc.body.innerHTML = element.innerHTML;

    const cleanUp = () => {
      frame.remove();
      resolve();
    };
    win.addEventListener('afterprint', cleanUp, { once: true });
    win.focus();
    win.print();
    // Some engines never fire afterprint for a frame; print() blocks until the dialog closes anyway
    setTimeout(() => {
      if (frame.isConnected) cleanUp();
    }, 1000);
  });
}
