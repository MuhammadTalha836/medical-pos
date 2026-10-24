import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '../../services/apiService';
import { SaleInvoice, SystemSettings } from '../../types';
import { Modal } from '../common/Modal';
import { UnifiedInvoice } from '../pos/UnifiedInvoice';

interface InvoiceModalProps {
  /** Sale to show; null closes the modal */
  saleId: number | null;
  settings?: SystemSettings | null;
  onClose: () => void;
}

// One saved invoice with all its items; Print reprints it on this computer's receipt printer
export const InvoiceModal: React.FC<InvoiceModalProps> = ({ saleId, settings, onClose }) => {
  const [invoice, setInvoice] = useState<SaleInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInvoice(null);
    setError(null);
    if (saleId === null) return;
    let cancelled = false;
    api.getSaleById(saleId)
      .then(inv => { if (!cancelled) setInvoice(inv); })
      .catch(err => { if (!cancelled) setError(err.message || 'Could not open the invoice'); });
    return () => { cancelled = true; };
  }, [saleId]);

  return (
    <Modal
      isOpen={saleId !== null}
      onClose={onClose}
      title={invoice ? `Invoice ${invoice.invoice_no}` : 'Invoice'}
      maxWidth="max-w-md"
    >
      {error ? (
        <p className="text-sm text-rose-600 dark:text-rose-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </p>
      ) : !invoice ? (
        <div className="py-10 text-center text-sm text-slate-500">Loading invoice…</div>
      ) : (
        <div className="space-y-3">
          {invoice.status === 'returned' && (
            <p className="badge-warning inline-flex">Items on this invoice were returned</p>
          )}
          <UnifiedInvoice invoice={invoice} settings={settings} onClose={onClose} />
        </div>
      )}
    </Modal>
  );
};
