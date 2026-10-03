import { describe, it, expect } from 'vitest';
import { ProviderBalanceInsufficientError, ProviderBalanceNotShortError } from './errors';

// UAT round 2: the refusal printed raw "100000 ... 300000" next to rupiah
// figures everywhere else on the same screen.
describe('provider balance refusals quote rupiah', () => {
  it('formats both figures of the insufficient-balance refusal', () => {
    const err = new ProviderBalanceInsufficientError(300_000, 100_000, 'Xendit');
    expect(err.message).toContain('Rp100.000');
    expect(err.message).toContain('Rp300.000');
    expect(err.message).not.toMatch(/\b100000\b|\b300000\b/);
  });

  it('formats both figures of the not-short refusal', () => {
    const err = new ProviderBalanceNotShortError(300_000, 500_000);
    expect(err.message).toContain('Rp500.000');
    expect(err.message).toContain('Rp300.000');
  });
});
