import React from 'react';
import { Code2 } from 'lucide-react';
import { developerInfoFor, formatDeveloperLine, type DeveloperPlacement } from '../../../shared/developerProfile';

interface DeveloperCreditProps {
  settings: object | null | undefined;
  placement: Extract<DeveloperPlacement, 'login' | 'sidebar'>;
}

/** The Developer's contact line for the login screen or the sidebar (only the details chosen for that place). */
export const DeveloperCredit: React.FC<DeveloperCreditProps> = ({ settings, placement }) => {
  const items = developerInfoFor(settings, placement);
  if (items.length === 0) return null;

  if (placement === 'login') {
    return (
      <p className="text-center text-xs text-slate-500 dark:text-slate-400 select-text">
        {formatDeveloperLine(items)}
      </p>
    );
  }

  return (
    <div className="m-3 p-3 rounded-xl bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs select-text">
      <div className="flex items-center gap-1.5 font-semibold text-slate-500 dark:text-slate-400 mb-1">
        <Code2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
        <span>Software by</span>
      </div>
      {items.map(item => (
        <div
          key={item.key}
          className={item.key === 'name' || item.key === 'company'
            ? 'font-bold text-slate-800 dark:text-slate-100 truncate'
            : 'text-slate-600 dark:text-slate-300 truncate'}
          title={item.value}
        >
          {item.value}
        </div>
      ))}
    </div>
  );
};
