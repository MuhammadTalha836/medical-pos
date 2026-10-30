import React, { useState } from 'react';
import { Plus, SlidersHorizontal, X } from 'lucide-react';
import { DEFAULT_UNIT_TYPES, UNIT_TYPE_NAME_MAX, UNIT_TYPES_MAX, parseUnitTypes } from '../../../shared/unitTypes';

interface StoreRulesCardProps {
  values: Record<string, string | undefined>;
  onChange: (key: string, value: string) => void;
  /** The second-shift rule is a shift rule: only shift managers change it (the server checks it too) */
  canManageShifts: boolean;
}

/** Phase C store rules in Settings → Store: round-off, quotation validity, medicine units, second shift */
export const StoreRulesCard: React.FC<StoreRulesCardProps> = ({ values, onChange, canManageShifts }) => {
  const [newUnit, setNewUnit] = useState('');
  const units = parseUnitTypes(values.medicine_unit_types);
  const saveUnits = (list: string[]) => onChange('medicine_unit_types', JSON.stringify(list));

  const addUnit = () => {
    const name = newUnit.trim();
    if (!name || units.some(u => u.toLowerCase() === name.toLowerCase()) || units.length >= UNIT_TYPES_MAX) return;
    saveUnits([...units, name]);
    setNewUnit('');
  };

  return (
    <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5 shadow-xs">
      <div className="flex items-center space-x-2">
        <SlidersHorizontal className="w-5 h-5 text-teal-600 dark:text-teal-400" />
        <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Billing & Counter Rules</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="round_off_to" className="field-label">Round off bills</label>
          <select
            id="round_off_to"
            value={values.round_off_to ?? '0'}
            onChange={e => onChange('round_off_to', e.target.value)}
            className="field-select w-full"
          >
            <option value="0">Off (exact amount)</option>
            <option value="1">To the nearest 1</option>
            <option value="5">To the nearest 5</option>
            <option value="10">To the nearest 10</option>
          </select>
          <p className="field-hint">After all discounts the bill is rounded, e.g. 198 becomes 200 with 10. The receipt shows the round-off line.</p>
        </div>

        <div>
          <label htmlFor="quotation_valid_days" className="field-label">Quotation valid for (days)</label>
          <input
            id="quotation_valid_days"
            type="number"
            min="1"
            max="30"
            step="1"
            value={values.quotation_valid_days ?? '1'}
            onChange={e => onChange('quotation_valid_days', e.target.value)}
            className="field-input w-32 font-mono"
          />
          <p className="field-hint">1 prints "Prices valid today only". A quotation is never a sale.</p>
        </div>
      </div>

      <div>
        <span className="field-label">Medicine units</span>
        <div className="flex flex-wrap gap-1.5">
          {units.map(unit => (
            <span key={unit} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
              {unit}
              <button
                type="button"
                onClick={() => saveUnits(units.filter(u => u !== unit))}
                disabled={units.length <= 1}
                title={`Remove ${unit}`}
                aria-label={`Remove ${unit}`}
                className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <input
            type="text"
            value={newUnit}
            maxLength={UNIT_TYPE_NAME_MAX}
            onChange={e => setNewUnit(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUnit(); } }}
            placeholder="e.g. ml, Litre, Vial"
            aria-label="New medicine unit"
            className="field-input field-sm w-48"
          />
          <button type="button" onClick={addUnit} disabled={!newUnit.trim()} className="btn-secondary btn-sm">
            <Plus className="w-4 h-4" />
            <span>Add unit</span>
          </button>
          <button type="button" onClick={() => saveUnits([...DEFAULT_UNIT_TYPES])} className="btn-secondary btn-sm">Reset list</button>
        </div>
        <p className="field-hint">The choices in the medicine form. Removing a unit does not change medicines that already use it.</p>
      </div>

      <label className={`flex items-start gap-2 ${canManageShifts ? 'cursor-pointer' : 'opacity-60'}`}>
        <input
          type="checkbox"
          checked={(values.allow_second_shift_same_day ?? 'true') !== 'false'}
          disabled={!canManageShifts}
          onChange={e => onChange('allow_second_shift_same_day', e.target.checked ? 'true' : 'false')}
          className="mt-0.5 accent-teal-600"
        />
        <span>
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Allow a second shift on the same day</span>
          <span className="field-hint block">
            When off, each person can start one shift per day; a manager can still reopen it.
            {!canManageShifts && ' Only shift managers can change this.'}
          </span>
        </span>
      </label>
    </div>
  );
};
