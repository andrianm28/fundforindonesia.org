// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentSandboxStamp, sandboxModeOf } from './sandbox-mode';

/**
 * The mode of a movement of money (ticket rilis-1-benda/94, scope 1).
 */
describe('sandboxModeOf / currentSandboxStamp', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('takes the mode of the row it is about, whatever the marker says now', () => {
    vi.stubEnv('BETA_SANDBOX', '');
    expect(sandboxModeOf({ sandbox: true })).toBe(true);
    vi.stubEnv('BETA_SANDBOX', 'true');
    expect(sandboxModeOf({ sandbox: false })).toBe(false);
  });

  it('stamps a row with no source from the marker in force, and only the exact string counts', () => {
    vi.stubEnv('BETA_SANDBOX', 'true');
    expect(currentSandboxStamp()).toBe(true);
    for (const almost of ['', 'True', '1', 'yes', 'true ']) {
      vi.stubEnv('BETA_SANDBOX', almost);
      expect(currentSandboxStamp()).toBe(false);
    }
  });
});

/**
 * "Every creation site passes the mode": the guarantee behind the default of
 * `postTransaction`'s `sandbox` option being real money. A caller that forgot
 * it would hide test money from a test screen, which is the safe failure, but a
 * caller that forgot it on a beta Payment would put test money in the real pool.
 * So the source is scanned: every call of postTransaction outside ledger.ts and
 * the tests names `sandbox` in its options, even if only to say `sandbox: false`.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The text of the call that opens at `start` (the index of its "("), by balancing parentheses. */
function callText(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '(') depth++;
    if (source[i] === ')' && --depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

describe('every ledger posting names its mode', () => {
  const files = sourceFiles('src').filter((f) => !f.endsWith(join('money', 'ledger.ts')));
  const calls: Array<{ file: string; text: string }> = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bpostTransaction\(/g)) {
      calls.push({ file, text: callText(source, match.index! + match[0].length - 1) });
    }
  }

  it('finds the creation sites at all', () => {
    // A scan that matched nothing would pass for the wrong reason.
    expect(new Set(calls.map((c) => c.file)).size).toBeGreaterThanOrEqual(7);
  });

  it.each(calls.map((c, i) => [`${c.file} #${i}`, c.text]))('%s passes `sandbox`', (_name, text) => {
    expect(text).toMatch(/\bsandbox\b/);
  });
});

/**
 * The simulation never reaches a payment provider (ticket 94, scope 3): the
 * money modules do not import the provider registry or call a provider's
 * disbursement or refund method at all. This holds for real money as well, for
 * the reason approvePayout documents (ADR 0006: a second Admin moves the money
 * by hand), so a test-money lifecycle cannot reach a provider either. The
 * real-database test additionally spies on the registry for the whole cycle.
 */
describe('the money modules never reach a payment provider', () => {
  // The modules that hold money or move it OUT. The collecting door
  // (donation-charge.ts, payment-method-map.ts) is meant to talk to a provider.
  const MOVES_MONEY = [
    'payouts', 'refunds', 'escrow', 'ledger', 'manual-contributions', 'campaign-transfers',
    'provider-withdrawals', 'trip-payout-funds', 'impact', 'dormant-balances', 'refund-standing',
    'counted-payment',
  ];
  const moneyFiles = MOVES_MONEY.map((name) => join('src', 'lib', 'money', `${name}.ts`));
  const providerCalls = /\.(createPayout|createRefund|createCharge)\(|from '@\/lib\/payments'|from '@\/lib\/payments\/(index|active-provider|sumopod-provider)'/;

  it('finds the money modules at all', () => {
    expect(moneyFiles.every((f) => readFileSync(f, 'utf8').length > 0)).toBe(true);
  });

  it.each(moneyFiles.map((f) => [f]))('%s', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(providerCalls);
  });
});
