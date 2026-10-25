import React from 'react';
import { normalizeSchedule } from '../../../shared/schedule';

const STYLES = {
  rx: { label: 'Rx', title: 'Sold on prescription', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30' },
  controlled: { label: 'Controlled', title: 'Controlled medicine: prescription details go into the register', className: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30' }
} as const;

/** Small Rx / Controlled tag for a medicine; renders nothing for ordinary medicines */
export const ScheduleBadge: React.FC<{ schedule?: string | null }> = ({ schedule }) => {
  const value = normalizeSchedule(schedule);
  if (value === 'none') return null;
  const style = STYLES[value];
  return (
    <span title={style.title} className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-2xs font-bold border whitespace-nowrap ${style.className}`}>
      {style.label}
    </span>
  );
};
