const DEFAULT_CURRENCY = 'Rs.';

export function currencySymbol(settings?: { currency_symbol?: string } | null): string {
  return settings?.currency_symbol || DEFAULT_CURRENCY;
}

/** "Rs. 1250.00" — every amount on screen and on receipts uses this format. */
export function formatMoney(amount: number | string | null | undefined, currency: string = DEFAULT_CURRENCY): string {
  return `${currency} ${(Number(amount) || 0).toFixed(2)}`;
}

/** Formatter bound to the store's currency symbol, for components that print many amounts. */
export function moneyFormatter(settings?: { currency_symbol?: string } | null) {
  const currency = currencySymbol(settings);
  return (amount: number | string | null | undefined) => formatMoney(amount, currency);
}

/** "2h 5m" for a running or closed shift. */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
