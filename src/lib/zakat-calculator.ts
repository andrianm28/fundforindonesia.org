/**
 * Kalkulator zakat sederhana (PKS pemenuhan 19; ADR 0028). Murni: dipakai
 * server dan browser. Hanya membantu menghitung; nominal akhir tetap diisi
 * sendiri oleh pembayar, dan kalkulator ini bukan fatwa.
 *
 * Nisab tahunan dari setelan Admin (nilai rupiah, biasanya setara 85 gram
 * emas). Zakat penghasilan: penghasilan bulanan (gaji + lainnya) yang
 * mencapai seperduabelas nisab. Zakat maal: harta bersih setelah dikurangi
 * utang jatuh tempo, yang mencapai nisab (haul satu tahun adalah syarat yang
 * dinyatakan pada halaman, tidak dihitung di sini). Tarif tetap 2,5%.
 */

export const ZAKAT_RATE_PERCENT = 2.5;

/**
 * The most one input may be, in rupiah (Rp10 triliun, far above any real
 * wealth figure). It keeps every sum of four inputs and its product with the
 * rate far inside the safe integer range (4e13 * 25 = 1e15 < 9.007e15), so a
 * pasted absurd number is refused rather than silently losing precision.
 */
export const ZAKAT_INPUT_MAX = 10_000_000_000_000;
export const ZAKAT_INPUT_MAX_MESSAGE = 'tidak boleh lebih dari Rp10.000.000.000.000';

export type ZakatResult = {
  /** Whether the base reaches the threshold. */
  obligatory: boolean;
  /** What the rate is applied to. */
  base: number;
  /** The nisab the base was compared with: monthly for penghasilan, yearly for maal. */
  threshold: number;
  /** The zakat in whole rupiah; 0 when not obligatory. */
  amount: number;
};

function wholeRupiah(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} harus berupa bilangan bulat rupiah, tidak negatif.`);
  }
  if (value > ZAKAT_INPUT_MAX) throw new Error(`${label} ${ZAKAT_INPUT_MAX_MESSAGE}.`);
  return value;
}

function requireNisab(nisab: number): number {
  if (!Number.isSafeInteger(nisab) || nisab <= 0) throw new Error('Nisab harus berupa bilangan bulat rupiah lebih dari 0.');
  return nisab;
}

/** Whole-rupiah 2,5% of `base`, half up, in integers so no float error enters a money figure. */
function rate(base: number): number {
  return Math.floor((base * 25 + 500) / 1000);
}

/** The monthly nisab: a twelfth of the yearly one, rounded up so a borderline income is not called obligatory. */
export function zakatNisabPerMonth(nisab: number): number {
  return Math.ceil(requireNisab(nisab) / 12);
}

export function calculateZakatPenghasilan(input: {
  nisab: number;
  monthlyIncome: number;
  otherMonthlyIncome: number;
}): ZakatResult {
  const threshold = zakatNisabPerMonth(input.nisab);
  const base = wholeRupiah(input.monthlyIncome, 'Penghasilan bulanan') + wholeRupiah(input.otherMonthlyIncome, 'Penghasilan lain');
  const obligatory = base >= threshold;
  return { obligatory, base, threshold, amount: obligatory ? rate(base) : 0 };
}

export function calculateZakatMaal(input: {
  nisab: number;
  savings: number;
  goldAndInvestments: number;
  tradeAssets: number;
  debtsDue: number;
}): ZakatResult {
  const threshold = requireNisab(input.nisab);
  const assets =
    wholeRupiah(input.savings, 'Tabungan') +
    wholeRupiah(input.goldAndInvestments, 'Emas dan investasi') +
    wholeRupiah(input.tradeAssets, 'Aset usaha');
  const base = Math.max(0, assets - wholeRupiah(input.debtsDue, 'Utang jatuh tempo'));
  const obligatory = base >= threshold;
  return { obligatory, base, threshold, amount: obligatory ? rate(base) : 0 };
}
