'use client';

/** What the Fundraiser attests to when submitting a Campaign (PKS pasal 3.3). */
export const TRUTH_STATEMENT_TEXT =
  'Saya menyatakan bahwa seluruh data dan dokumen yang saya isi untuk Campaign ini adalah benar dan dapat dipertanggungjawabkan.';

/**
 * The required "pernyataan kebenaran data" checkbox beside every
 * "Ajukan ke Verifier" button. The server refuses a submission without it
 * (submitCampaign), so this is only the visible half.
 */
export function TruthStatementField({
  checked,
  onChange,
  disabled = false,
  error,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div>
      <label className="flex items-start gap-2 text-sm text-text">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{TRUTH_STATEMENT_TEXT}</span>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
