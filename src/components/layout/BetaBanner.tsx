/**
 * The "Beta, tidak ada uang nyata" notice (ticket rilis-1-benda/92).
 *
 * Purely presentational: it never decides whether it should show. A server
 * component reads the BETA_SANDBOX marker and renders this only while it is on
 * (the root layout, the Receipt page); a client component is handed the answer
 * as a prop and never reads the environment itself. No hooks and no
 * 'use client', so it renders on either side.
 *
 * Three wordings, because the three places say different things to different
 * people: the site-wide bar tells a visitor what the site is, the donation
 * confirmation tells a Donor what pressing the button will and will not do,
 * and the Receipt tells whoever holds a printout that it proves nothing.
 */

export type BetaBannerVariant = 'site' | 'donation' | 'receipt';

export const BETA_BANNER_COPY: Record<BetaBannerVariant, { title: string; body: string }> = {
  site: {
    title: 'Beta, tidak ada uang nyata.',
    body: 'Situs ini sedang diuji. Pembayaran memakai sandbox, jadi tidak ada dana yang benar-benar berpindah dan tidak ada donasi yang sungguhan.',
  },
  donation: {
    title: 'Beta, tidak ada uang nyata.',
    body: 'Donasi ini hanya uji coba. Anda tidak akan ditagih sungguhan dan tidak ada dana yang berpindah ke Campaign ini.',
  },
  receipt: {
    title: 'Beta, tidak ada uang nyata.',
    body: 'Bukti ini berasal dari masa uji coba. Tidak ada dana yang benar-benar dibayarkan, jadi jangan dipakai sebagai bukti donasi.',
  },
};

const VARIANT_CLASS: Record<BetaBannerVariant, string> = {
  site: 'w-full bg-amber-100 px-4 py-2 text-center text-sm text-amber-900',
  donation: 'rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900',
  receipt: 'rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 print:border print:border-amber-900',
};

export function BetaBanner({ variant = 'site' }: { variant?: BetaBannerVariant }) {
  const copy = BETA_BANNER_COPY[variant];
  return (
    <div role="note" aria-label="Mode beta" data-testid="beta-banner" className={VARIANT_CLASS[variant]}>
      <strong className="font-semibold">{copy.title}</strong> {copy.body}
    </div>
  );
}
