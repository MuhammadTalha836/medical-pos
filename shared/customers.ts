/** Customer rules shared by the POS customer picker, the Khata page and the API. */

/** Name shown (and printed) when a sale is not linked to a saved customer */
export const COUNTER_CUSTOMER = 'Counter Customer';

export const CUSTOMER_NAME_MAX = 80;
export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

/** Digits only, so "0300-1234567", "0300 1234567" and "03001234567" are the same phone. */
export function normalizePhone(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

export function isValidPhone(phone: string | null | undefined): boolean {
  const digits = normalizePhone(phone);
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
}

/** True for the default walk-in name (any case/spacing), which never needs a saved customer */
export function isCounterCustomer(name: string | null | undefined): boolean {
  const trimmed = (name ?? '').trim().toLowerCase();
  return trimmed === '' || trimmed === COUNTER_CUSTOMER.toLowerCase();
}
