import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ticket 49 guard. `tripHeldBalance` (./trip-payout-funds.ts) attributes a
 * TRIP_BALANCE entry to a Batch through `paymentId`, or through `refundId` ->
 * Refund.paymentId, and INNER JOINs on that. An entry with neither would drop
 * out of the join and silently count as "not held", lifting the Payout ceiling.
 * Only a Payout leg (payoutId) is meant to be outside it.
 *
 * Chosen form: a static scan, not a changed query. The query's current
 * behaviour is right for Payout legs; what must never happen is a NEW
 * TRIP_BALANCE writer that forgets the attribution. So this test pins (1) the
 * set of ledger.ts builders that can emit a TRIP_BALANCE leg, and (2) that
 * every postTransaction call using one passes the matching option.
 */

const MONEY_DIR = __dirname;
const SRC_DIR = join(__dirname, '..', '..');

/** What each TRIP_BALANCE-capable builder's postTransaction call must carry. */
const REQUIRED_OPTION: Record<string, 'paymentId' | 'refundId' | 'payoutId'> = {
  escrowReleaseLegs: 'paymentId',
  refundRequestedLegs: 'refundId',
  refundApprovedLegs: 'refundId',
  payoutInstructedLegs: 'payoutId', // the Payout leg: deliberately outside the held figure
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Text of every `postTransaction( ... )` call, by balanced parentheses. */
function postTransactionCalls(source: string): string[] {
  const calls: string[] = [];
  const re = /\bpostTransaction\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }
    calls.push(source.slice(m.index, i));
  }
  return calls;
}

describe('TRIP_BALANCE entries are attributable to a Payment or Refund (ticket 49)', () => {
  it('only the known ledger.ts builders can emit a TRIP_BALANCE leg', () => {
    const ledger = readFileSync(join(MONEY_DIR, 'ledger.ts'), 'utf8');
    // Block and line comments name the account in prose; strip them first.
    const code = ledger.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const builders = [...code.matchAll(/export function (\w+Legs)\(([\s\S]*?)\n\}/g)]
      .filter((match) => /balanceAccount\(|\bsource\b|'TRIP_BALANCE'/.test(match[2]))
      .map((match) => match[1])
      .sort();
    expect(builders).toEqual(Object.keys(REQUIRED_OPTION).sort());
  });

  it('no file outside ledger.ts builds a TRIP_BALANCE leg by hand', () => {
    const offenders = walk(SRC_DIR)
      .filter((f) => !f.endsWith(join('money', 'ledger.ts')))
      .filter((f) => /account:\s*'TRIP_BALANCE'/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('every postTransaction call using such a builder passes the attribution option', () => {
    const checked: string[] = [];
    for (const file of walk(SRC_DIR)) {
      for (const call of postTransactionCalls(readFileSync(file, 'utf8'))) {
        for (const [builder, option] of Object.entries(REQUIRED_OPTION)) {
          if (!call.includes(`${builder}(`)) continue;
          checked.push(builder);
          expect(call, `${file}: ${builder} must post with ${option}`).toMatch(
            new RegExp(`\\b${option}\\s*:`),
          );
        }
      }
    }
    // Guards the scan itself: all four writers were actually found.
    expect([...new Set(checked)].sort()).toEqual(Object.keys(REQUIRED_OPTION).sort());
  });
});
