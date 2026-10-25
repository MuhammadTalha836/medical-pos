import React, { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { normalizePhone } from '../../../shared/customers';
import { whatsappLink } from '../../../shared/whatsapp';
import { copyText } from '../../utils/copyText';

interface WhatsAppButtonProps {
  phone: string | null | undefined;
  /** The message, built only when the button is clicked */
  message: () => string;
  label?: string;
  className?: string;
}

/**
 * Opens WhatsApp with the message ready to send. Hidden when there is no phone; disabled, with the reason,
 * when the phone cannot be a WhatsApp number (e.g. a mobile number missing a digit).
 */
export const WhatsAppButton: React.FC<WhatsAppButtonProps> = ({ phone, message, label = 'WhatsApp', className = 'btn-secondary btn-sm' }) => {
  const [notice, setNotice] = useState<string | null>(null);
  if (!normalizePhone(phone)) return null;
  const usable = whatsappLink(phone, '') !== null;

  const send = async () => {
    const text = message();
    const link = whatsappLink(phone, text);
    let opened = false;
    try {
      opened = Boolean(link && (await window.electronAPI?.openWhatsApp(link)));
    } catch {
      opened = false;
    }
    if (opened) {
      setNotice(null);
      return;
    }
    setNotice((await copyText(text))
      ? 'WhatsApp could not be opened. The message was copied; paste it into WhatsApp.'
      : 'WhatsApp could not be opened.');
  };

  const shown = usable ? notice : `${phone} is not a WhatsApp number. Correct the customer's phone (e.g. 0300-1234567).`;

  return (
    <span className="inline-flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={send}
        disabled={!usable}
        className={className}
        title={usable ? `Send on WhatsApp to ${phone}` : undefined}
      >
        <MessageCircle className="w-4 h-4" />
        <span>{label}</span>
      </button>
      {shown && <span role="status" className="text-2xs text-amber-700 dark:text-amber-400 max-w-56 text-center">{shown}</span>}
    </span>
  );
};
