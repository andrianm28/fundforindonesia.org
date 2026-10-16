/**
 * Identitas penyelenggara platform: satu-satunya tempat nama operator dan
 * alamat email kontak resmi ditulis. Dipakai Syarat & Ketentuan, Kebijakan
 * Privasi, Footer, dan sebagai bawaan halaman Kontak (DEFAULT_SITE_SETTINGS).
 *
 * Operator adalah PT Jaya Korpora Prima (ADR 0009). Nomor NIB, alamat kantor,
 * dan telepon sengaja tidak ada di sini sampai owner memberikan nilai yang
 * benar; jangan diisi dengan nilai contoh. Admin dapat mengisi alamat dan
 * telepon dari Pengaturan Laman Publik.
 */
export const SITE_IDENTITY = {
  /** Penyelenggara platform dan Pengendali Data Pribadi (ADR 0009). */
  operatorName: 'PT Jaya Korpora Prima',
  /** Nama produk yang dilihat pengunjung. */
  brandName: 'Fund for Indonesia',
  /** Kontak umum. */
  contactEmail: 'halo@fundforindonesia.org',
  /** Permintaan hak subjek data (akses, koreksi, anonimisasi) dan pertanyaan privasi. */
  privacyEmail: 'privasi@fundforindonesia.org',
} as const;

/** Tanggal revisi Syarat & Ketentuan dan Kebijakan Privasi. */
export const LEGAL_DOCS_UPDATED = '16 Oktober 2026';
