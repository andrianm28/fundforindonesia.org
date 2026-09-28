import { describe, it, expect } from 'vitest';

import { exceedsPayoutBalance } from './payout-balance-rule';

describe('exceedsPayoutBalance', () => {
  it('passes an amount that is part of the balance, up to and including all of it', () => {
    // CONTEXT.md, Payout: a Fundraiser asks to send "sebagian Campaign
    // Balance" -- part of it. The whole balance is still part of it, and
    // requestPayout/approvePayout have always allowed a Payout for the exact
    // balance (they compare with `>`), so a rule that refused it would change
    // what a Fundraiser may do today.
    expect(exceedsPayoutBalance(1, 800_000)).toBe(false);
    expect(exceedsPayoutBalance(400_000, 800_000)).toBe(false);
    expect(exceedsPayoutBalance(800_000, 800_000)).toBe(false);
  });

  it('refuses an amount past the balance, by a single rupiah as much as by all of it', () => {
    expect(exceedsPayoutBalance(800_001, 800_000)).toBe(true);
    expect(exceedsPayoutBalance(9_000_000, 800_000)).toBe(true);
  });

  it('is not a verdict on whether the amount is a real request', () => {
    // Zero over zero is not "over", and a negative amount is not "over" either.
    // Whether the amount is a request at all is judged somewhere else (the
    // route's own bound, and the field itself); this one question is only ever
    // "more than the balance", so a caller that reads it as a general validity
    // check is reading more into it than it says.
    expect(exceedsPayoutBalance(0, 0)).toBe(false);
    expect(exceedsPayoutBalance(0, 800_000)).toBe(false);
  });
});
