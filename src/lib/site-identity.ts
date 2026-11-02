/**
 * Identitas penyelenggara platform: satu-satunya tempat nama operator dan
 * alamat email kontak resmi ditulis. Dipakai Syarat & Ketentuan, Kebijakan
 * Privasi, Footer, dan sebagai bawaan halaman Kontak (DEFAULT_SITE_SETTINGS).
 *
 * Keputusan owner 2026-11-02: nama badan usaha operator tidak ditampilkan di
 * situs; halaman publik dan legal hanya menyebut Fund for Indonesia. Nomor NIB, alamat kantor,
 * dan telepon sengaja tidak ada di sini; jangan diisi dengan nilai contoh.
 * Keputusan owner 2026-10-29: dibiarkan kosong, Admin mengisinya dari
 * Pengaturan Laman Publik (kontak: alamat, telepon, WhatsApp, NIB).
 */
export const SITE_IDENTITY = {
  /** Nama yang dilihat pengunjung; juga dipakai sebagai penyelenggara dan Pengendali Data Pribadi di halaman legal. */
  brandName: 'Fund for Indonesia',
  /** Kontak umum. */
  contactEmail: 'halo@fundforindonesia.org',
  /** Permintaan hak subjek data (akses, koreksi, anonimisasi) dan pertanyaan privasi. */
  privacyEmail: 'privasi@fundforindonesia.org',
} as const;

/** Tanggal revisi Syarat & Ketentuan dan Kebijakan Privasi. */
export const LEGAL_DOCS_UPDATED = '2 November 2026';
