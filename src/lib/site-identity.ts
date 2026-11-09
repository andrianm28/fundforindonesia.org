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

/**
 * Versi yang dicatat pada persetujuan pengguna (UserConsent.version), berbentuk
 * YYYY-MM-DD. Satu-satunya sumber: LEGAL_DOCS_UPDATED diturunkan darinya.
 * Mengubah teks Syarat atau Privasi berarti menaikkan konstanta ini; semua
 * pengguna lalu diminta menyetujui ulang, dan persetujuan lama tetap tercatat
 * dengan versinya.
 */
export const LEGAL_DOCS_VERSION = '2026-11-02';

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** "2026-10-16" -> "16 Oktober 2026". */
export function formatLegalDocsDate(version: string): string {
  const [y, m, d] = version.split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
}

/** Tanggal revisi Syarat & Ketentuan dan Kebijakan Privasi, diturunkan dari LEGAL_DOCS_VERSION. */
export const LEGAL_DOCS_UPDATED = formatLegalDocsDate(LEGAL_DOCS_VERSION);
