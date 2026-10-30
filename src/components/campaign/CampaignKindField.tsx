'use client';

import { KIND_LABEL, KINDS, type CampaignKind } from '@/lib/campaign-kind';

/** The Kind select of the Campaign form (creation wizard and edit screen). */
export function CampaignKindField({
  value,
  error,
  onChange,
}: {
  value: CampaignKind | '';
  error?: string;
  onChange: (kind: CampaignKind | '') => void;
}) {
  return (
    <div className="w-full">
      <label htmlFor="campaign-kind" className="block text-sm font-medium text-text mb-1.5">
        Kind <span className="text-danger ml-0.5">*</span>
      </label>
      <select
        id="campaign-kind"
        aria-label="Kind"
        value={value}
        onChange={(e) => onChange(e.target.value as CampaignKind | '')}
        className={`w-full px-3 py-2.5 text-sm rounded-md border transition-colors duration-150 focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary ${
          error ? 'border-danger focus:ring-danger/20 focus:border-danger' : 'border-border hover:border-text-secondary/50'
        }`}
      >
        <option value="">Pilih Kind</option>
        {KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {KIND_LABEL[kind]}
          </option>
        ))}
      </select>
      {error ? (
        <p className="mt-1 text-xs text-danger">{error}</p>
      ) : (
        <p className="mt-1 text-xs text-text-secondary">
          Kind menentukan aturan dana Campaign dan tidak dapat diubah setelah diajukan.
        </p>
      )}
    </div>
  );
}
