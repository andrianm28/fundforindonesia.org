import { describe, it, expect } from 'vitest';
import { ZAKAT_RATE_PERCENT, calculateZakatMaal, calculateZakatPenghasilan, zakatNisabPerMonth } from './zakat-calculator';

/**
 * Kalkulator zakat sederhana (PKS pemenuhan 19). Nilai harapan dihitung
 * tangan dari contoh kerja: nisab tahunan Rp85.000.000, tarif 2,5%.
 */
const NISAB = 85_000_000;

describe('zakat calculator', () => {
  it('uses the fixed rate of 2.5 percent', () => {
    expect(ZAKAT_RATE_PERCENT).toBe(2.5);
  });

  it('derives the monthly nisab as a twelfth of the yearly one, rounded up', () => {
    expect(zakatNisabPerMonth(NISAB)).toBe(7_083_334);
    expect(zakatNisabPerMonth(12_000_000)).toBe(1_000_000);
  });

  it('owes zakat penghasilan of 2.5% when monthly income reaches the monthly nisab', () => {
    expect(calculateZakatPenghasilan({ nisab: NISAB, monthlyIncome: 10_000_000, otherMonthlyIncome: 2_000_000 })).toEqual({
      obligatory: true,
      base: 12_000_000,
      threshold: 7_083_334,
      amount: 300_000,
    });
  });

  it('owes nothing below the monthly nisab, and says so with the amount 0', () => {
    expect(calculateZakatPenghasilan({ nisab: NISAB, monthlyIncome: 7_083_333, otherMonthlyIncome: 0 })).toMatchObject({
      obligatory: false,
      amount: 0,
    });
  });

  it('owes at exactly the nisab, rounding the amount to a whole rupiah', () => {
    expect(calculateZakatPenghasilan({ nisab: NISAB, monthlyIncome: 7_083_334, otherMonthlyIncome: 0 })).toMatchObject({
      obligatory: true,
      amount: 177_083, // 7.083.334 x 2,5% = 177.083,35
    });
  });

  it('owes zakat maal of 2.5% of net wealth at or above the yearly nisab', () => {
    expect(
      calculateZakatMaal({ nisab: NISAB, savings: 90_000_000, goldAndInvestments: 30_000_000, tradeAssets: 0, debtsDue: 20_000_000 }),
    ).toEqual({ obligatory: true, base: 100_000_000, threshold: NISAB, amount: 2_500_000 });
  });

  it('subtracts debts due and owes nothing when what is left is under the nisab', () => {
    expect(
      calculateZakatMaal({ nisab: NISAB, savings: 90_000_000, goldAndInvestments: 0, tradeAssets: 0, debtsDue: 10_000_000 }),
    ).toMatchObject({ obligatory: false, base: 80_000_000, amount: 0 });
  });

  it('never takes a negative base, and refuses a negative, fractional or missing input', () => {
    expect(calculateZakatMaal({ nisab: NISAB, savings: 0, goldAndInvestments: 0, tradeAssets: 0, debtsDue: 5_000_000 })).toMatchObject({
      base: 0,
      obligatory: false,
    });
    expect(() => calculateZakatPenghasilan({ nisab: NISAB, monthlyIncome: -1, otherMonthlyIncome: 0 })).toThrow();
    expect(() => calculateZakatPenghasilan({ nisab: NISAB, monthlyIncome: 1.5, otherMonthlyIncome: 0 })).toThrow();
    expect(() => calculateZakatMaal({ nisab: 0, savings: 1, goldAndInvestments: 0, tradeAssets: 0, debtsDue: 0 })).toThrow();
  });
});
