import React from 'react';
import { SaleInvoice, SystemSettings, InvoiceTemplateType, InvoicePaperSize } from '../../types';
import { UnifiedInvoice } from './UnifiedInvoice';

export interface ThermalReceiptProps {
  invoice: SaleInvoice;
  settings?: SystemSettings | null;
  templateOverride?: InvoiceTemplateType;
  paperSizeOverride?: InvoicePaperSize;
  onPrint?: () => void;
  onClose?: () => void;
  showControls?: boolean;
}

export const ThermalReceipt: React.FC<ThermalReceiptProps> = (props) => {
  return <UnifiedInvoice {...props} />;
};

export { UnifiedInvoice };
