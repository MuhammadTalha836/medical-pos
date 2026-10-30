// How an invoice status is shown everywhere (sales history, khata invoices, shift details)
const SALE_STATUS: Record<string, { label: string; badge: string }> = {
  completed: { label: 'Completed', badge: 'badge-success' },
  partially_returned: { label: 'Part returned', badge: 'badge-warning' },
  returned: { label: 'Returned', badge: 'badge-danger' },
  // A voided bill (C7): kept for the record, never counted
  cancelled: { label: 'Voided', badge: 'badge-danger' }
};

export const saleStatus = (status: string | null | undefined) =>
  SALE_STATUS[status ?? 'completed'] ?? { label: status ?? '', badge: 'badge-warning' };
