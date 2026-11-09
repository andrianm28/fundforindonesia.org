/**
 * The pathname map of ADR 0024 section 2, as plain data with no imports so
 * next.config.mjs, robots and the proxy can read it too.
 *
 * `internal` is the folder path under src/app. `id` is the Indonesian URL and
 * `en` the English one (after /en). In this first i18n PR `id` is still
 * today's URL for every row; the eleven renames the owner approved (Q1) are
 * recorded in PLANNED_INDONESIAN_RENAMES and land, with their 308 redirects,
 * in a later PR.
 */
export const pathnames = {
  '/': '/',
  '/explore/all': '/explore/all',
  '/explore/[category]': '/explore/[category]',
  '/campaign/[slug]': '/campaign/[slug]',
  '/campaign/[slug]/donate': '/campaign/[slug]/donate',
  '/program': '/program',
  '/program/[slug]': '/program/[slug]',
  '/volunteer-trip': '/volunteer-trip',
  '/volunteer-trip/[slug]': '/volunteer-trip/[slug]',
  '/impact': '/impact',
  '/faq': '/faq',
  '/search': '/search',
  '/about': '/about',
  '/careers': '/careers',
  '/press': '/press',
  '/help': '/help',
  '/contact': '/contact',
  '/terms': '/terms',
  '/privacy': '/privacy',
  '/login': '/login',
  '/register': '/register',
  '/receipt/[token]': '/receipt/[token]',
  '/akad-wakaf/[token]': '/akad-wakaf/[token]',
  '/sertifikat/[code]': { id: '/sertifikat/[code]', en: '/certificate/[code]' },
  '/lembaga/[id]': { id: '/lembaga/[id]', en: '/organisation/[id]' },
  // Reserved by Q7, pages not built yet.
  '/wakaf': { id: '/wakaf', en: '/waqf' },
  '/hibah': '/hibah',
  // Signed-in: one pathname in both languages.
  '/akun': '/akun',
  '/donasi-saya': '/donasi-saya',
  '/inbox': '/inbox',
  '/campaign/create': '/campaign/create',
  '/volunteer-trip/[slug]/daftar/[batchId]': '/volunteer-trip/[slug]/daftar/[batchId]',
  '/volunteer-trip/registrasi/[id]': '/volunteer-trip/registrasi/[id]',
} as const;

export type PathnameRow = { internal: string; id: string; en: string };

export const PATHNAME_MAP: readonly PathnameRow[] = Object.entries(pathnames).map(([internal, v]) =>
  typeof v === 'string' ? { internal, id: v, en: v } : { internal, ...v },
);

/** Q1: internal path -> the Indonesian URL it takes when the rename PR lands. */
export const PLANNED_INDONESIAN_RENAMES: Readonly<Record<string, string>> = {
  '/explore/all': '/jelajah/semua',
  '/explore/[category]': '/jelajah/[category]',
  '/campaign/[slug]/donate': '/campaign/[slug]/donasi',
  '/search': '/cari',
  '/about': '/tentang-kami',
  '/careers': '/karir',
  '/press': '/media',
  '/help': '/bantuan',
  '/contact': '/kontak',
  '/terms': '/syarat-dan-ketentuan',
  '/privacy': '/kebijakan-privasi',
};
