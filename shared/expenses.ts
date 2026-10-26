// Shop expenses (M8): payment methods, suggested categories and limits, shared by the server and the UI.

export const EXPENSE_PAYMENT_METHODS = ['cash', 'bank', 'cheque', 'online'] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];

export const EXPENSE_PAYMENT_LABELS: Record<ExpensePaymentMethod, string> = {
  cash: 'Cash',
  bank: 'Bank',
  cheque: 'Cheque',
  online: 'Online'
};

/** Suggested in the form; any other category can be typed */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Gas / Water',
  'Salaries & Wages',
  'Tea & Refreshments',
  'Transport',
  'Repairs',
  'Stationery',
  'Other'
];

export const EXPENSE_CATEGORY_MAX = 40;
export const EXPENSE_AMOUNT_MAX = 10_000_000;
export const EXPENSE_TEXT_MAX = 200;
