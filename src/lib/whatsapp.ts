/**
 * Nomor WhatsApp pengguna (PKS Pasal 3.1): opsional, format seluler Indonesia.
 *
 * Diterima: 0812-3456-7890, 62812 3456 7890, +62 812 3456 7890. Disimpan
 * dinormalkan sebagai `62` + nomor tanpa spasi atau tanda baca, jadi satu nomor
 * punya satu bentuk. Nomor seluler Indonesia: 628xx, 8 sampai 11 digit setelah
 * awalan 628.
 */
const MOBILE = /^628\d{8,11}$/;

export type WhatsappResult = { ok: true; value: string | null } | { ok: false; message: string };

export const WHATSAPP_INVALID = 'Nomor WhatsApp tidak valid. Gunakan format Indonesia, contoh 0812 3456 7890.';

/** Kosong berarti "tidak ada nomor" (null); selain itu harus nomor seluler Indonesia. */
export function normaliseWhatsapp(input: string | null | undefined): WhatsappResult {
  const raw = (input ?? '').trim();
  if (raw === '') return { ok: true, value: null };
  if (!/^\+?[\d\s().-]+$/.test(raw)) return { ok: false, message: WHATSAPP_INVALID };
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  if (!MOBILE.test(digits)) return { ok: false, message: WHATSAPP_INVALID };
  return { ok: true, value: digits };
}
