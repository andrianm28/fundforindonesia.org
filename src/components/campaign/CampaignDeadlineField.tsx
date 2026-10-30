'use client';

import type { CampaignKind } from '@/lib/campaign-kind';
import { todayWibDate } from '@/lib/utils/date';

/** The deadline date input of the Campaign form (creation wizard and edit screen). */
export function CampaignDeadlineField({
  kind,
  value,
  error,
  onChange,
}: {
  kind: CampaignKind | '';
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="w-full">
      <label htmlFor="campaign-deadline" className="block text-sm font-medium text-text mb-1.5">
        Batas Waktu{' '}
        {kind === 'WAKAF' ? (
          <span className="text-text-secondary font-normal">(opsional untuk Wakaf)</span>
        ) : (
          <span className="text-danger ml-0.5">*</span>
        )}
      </label>
      <input
        id="campaign-deadline"
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={todayWibDate()}
        className={`w-full px-3 py-2.5 text-sm rounded-md border transition-colors duration-150 focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary ${
          error ? 'border-danger focus:ring-danger/20 focus:border-danger' : 'border-border hover:border-text-secondary/50'
        }`}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
