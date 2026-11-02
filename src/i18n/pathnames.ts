/**
 * The pathname map of ADR 0024 section 2, as plain data with no imports so
 * next.config.mjs, robots and the proxy can read it too.
 *
 * `internal` is the folder path under src/app. `id` is the Indonesian URL and
 * `en` the English one (after /en). `id` always equals `internal`. The eleven
 * Indonesian renames the owner approved (Q1) are applied: the folder and the
 * Indonesian URL are the new name, the English URL keeps the old spelling, and
 * the old Indonesian URL 308s to the new one (next.config.mjs, redirects;
 * INDONESIAN_RENAMES below is the list both are checked against).
 */
export const pathnames = {
  '/': '/',
  '/jelajah/semua': { id: '/jelajah/semua', en: '/explore/all' },
  '/jelajah/[category]': { id: '/jelajah/[category]', en: '/explore/[category]' },
  '/campaign/[slug]': '/campaign/[slug]',
  '/campaign/[slug]/donasi': { id: '/campaign/[slug]/donasi', en: '/campaign/[slug]/donate' },
  '/program': '/program',
  '/program/[slug]': '/program/[slug]',
  '/volunteer-trip': '/volunteer-trip',
  '/volunteer-trip/[slug]': '/volunteer-trip/[slug]',
  '/impact': '/impact',
  '/faq': '/faq',
  '/cari': { id: '/cari', en: '/search' },
  '/tentang-kami': { id: '/tentang-kami', en: '/about' },
  '/karir': { id: '/karir', en: '/careers' },
  '/media': { id: '/media', en: '/press' },
  '/bantuan': { id: '/bantuan', en: '/help' },
  '/kontak': { id: '/kontak', en: '/contact' },
  '/syarat-dan-ketentuan': { id: '/syarat-dan-ketentuan', en: '/terms' },
  '/kebijakan-privasi': { id: '/kebijakan-privasi', en: '/privacy' },
  '/login': '/login',
  '/register': '/register',
  '/reset-password': '/reset-password',
  '/lupa-password': { id: '/lupa-password', en: '/forgot-password' },
  '/receipt/[token]': '/receipt/[token]',
  '/akad-wakaf/[token]': '/akad-wakaf/[token]',
  '/sertifikat/[code]': { id: '/sertifikat/[code]', en: '/certificate/[code]' },
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

/** Q1: the old Indonesian path (now the English one) -> the Indonesian URL that replaced it. */
export const INDONESIAN_RENAMES: Readonly<Record<string, string>> = {
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
