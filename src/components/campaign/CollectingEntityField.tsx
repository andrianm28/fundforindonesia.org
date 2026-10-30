'use client';

/** What GET /api/partner-organisations/sponsors answers (prd-compliance 10). */
export interface SponsorOptions {
  own: { id: string; name: string } | null;
  sponsors: { id: string; name: string }[];
}

/**
 * Who collects the Campaign's money (CONTEXT.md, Collecting Entity; ADR
 * 0010), said plainly: an organisation's own account collects in its
 * organisation's name; an individual Fundraiser picks a sponsoring Partner
 * Organisation, which a Verifier confirms when approving.
 */
export function CollectingEntityField({
  options,
  value,
  error,
  onChange,
}: {
  options: SponsorOptions | null;
  value: string;
  error?: string;
  onChange: (id: string) => void;
}) {
  if (!options) {
    return <p className="text-xs text-text-secondary">Memuat Partner Organisation...</p>;
  }
  if (options.own) {
    return (
      <div data-testid="collecting-entity" className="w-full rounded-md bg-bg-secondary p-3">
        <p className="text-sm font-medium text-text mb-1">Collecting Entity</p>
        <p className="text-sm text-text">
          Dana Campaign ini dihimpun atas nama {options.own.name}, organisasi yang diwakili akun Anda.
        </p>
      </div>
    );
  }
  return (
    <div data-testid="collecting-entity" className="w-full">
      <label htmlFor="collecting-entity" className="block text-sm font-medium text-text mb-1.5">
        Collecting Entity <span className="text-danger ml-0.5">*</span>
      </label>
      <p className="mb-2 text-xs text-text-secondary">
        Fundraiser perorangan menggalang dana di bawah naungan Partner Organisation yang memegang Fundraising
        Permit: dana Campaign dihimpun atas nama Partner Organisation itu, bukan atas nama Anda atau platform.
        Verifier mengonfirmasi Partner Organisation yang menaungi saat meloloskan pengajuan.
      </p>
      {options.sponsors.length === 0 ? (
        <p className="text-sm text-danger">
          Belum ada Partner Organisation yang menaungi Campaign perorangan. Anda tetap dapat menyimpan Draft,
          tetapi belum dapat mengajukannya ke Verifier.
        </p>
      ) : (
        <select
          id="collecting-entity"
          aria-label="Collecting Entity"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full px-3 py-2.5 text-sm rounded-md border transition-colors duration-150 focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary ${
            error ? 'border-danger focus:ring-danger/20 focus:border-danger' : 'border-border hover:border-text-secondary/50'
          }`}
        >
          <option value="">Pilih Partner Organisation</option>
          {options.sponsors.map((sponsor) => (
            <option key={sponsor.id} value={sponsor.id}>
              {sponsor.name}
            </option>
          ))}
        </select>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
