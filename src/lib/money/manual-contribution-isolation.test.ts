import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PROGRAM_BALANCE can never be the source of a Payout (prd-compliance 34;
 * CONTEXT.md, Program Balance; PRD FFI-09).
 *
 * A Program is not a Campaign. Its money is recorded, reported, and can be
 * reversed, and that is the whole of its life: there is no path -- not a
 * Payout request, not a withdrawal, not a reconciliation drain -- by which a
 * single rupiah of it leaves. This is asserted structurally rather than
 * described, because the failure mode is a future ticket widening a type
 * rather than a bug in today's code.
 *
 * csr-and-hibah 07 asks for exactly this assertion, and it is written here
 * rather than left to that ticket so the invariant cannot be a thing a later
 * branch has to remember.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const appFiles = () =>
  walk('src')
    .filter((file) => !file.startsWith('src/generated/'))
    .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'));

const source = (file: string) => readFileSync(file, 'utf8');

const schema = source(join(process.cwd(), 'prisma', 'schema.prisma'));

function blockOf(kind: 'model' | 'enum', name: string): string {
  const match = new RegExp(`^${kind} ${name} \\{[\\s\\S]*?^\\}`, 'm').exec(schema);
  if (!match) throw new Error(`prisma/schema.prisma has no ${kind} ${name}`);
  return match[0];
}

describe('a Program Balance is never money anyone can pay out', () => {
  it('gives Payout no way to name a Program at all', () => {
    // The bluntest guarantee there is: a Payout has a Campaign column and a
    // Volunteer Trip column, and no third one. A payout against a Program is
    // not refused -- it is unrepresentable.
    const payout = blockOf('model', 'Payout');
    expect(payout).toMatch(/campaignId\s+String\?/);
    expect(payout).toMatch(/volunteerTripId\s+String\?/);
    expect(payout).not.toMatch(/program/i);
  });

  it('gives BankAccount, the payout destination, no Program either', () => {
    expect(blockOf('model', 'BankAccount')).not.toMatch(/program/i);
  });

  it('keeps PROGRAM_BALANCE out of the Payout and Refund services entirely', () => {
    for (const file of ['src/lib/money/payouts.ts', 'src/lib/money/refunds.ts', 'src/lib/money/escrow.ts']) {
      expect(source(file)).not.toMatch(/PROGRAM_BALANCE|programBalance|programId/);
    }
  });

  it('keeps PROGRAM_BALANCE out of every Payout API route', () => {
    const payoutRoutes = appFiles().filter(
      (file) => file.includes('/payouts/') || file.endsWith('/payouts/route.ts'),
    );
    expect(payoutRoutes.length).toBeGreaterThan(0);

    for (const file of payoutRoutes) {
      expect(source(file)).not.toMatch(/PROGRAM_BALANCE|programBalance/);
    }
  });

  it('lets only the Manual Contribution module read a Program Balance', () => {
    // ledger.ts defines programBalance; one caller decides what it is for.
    // A second reader would be a second opinion on money that has no exit.
    const readers = appFiles().filter((file) => /\bprogramBalance\b/.test(source(file)));

    expect(readers.sort()).toEqual(['src/lib/money/ledger.ts', 'src/lib/money/manual-contributions.ts']);
  });

  it('credits PROGRAM_BALANCE from one place only, and only with a Manual Contribution', () => {
    // manualContributionReceivedLegs is the sole builder whose balance
    // account can be PROGRAM_BALANCE, and it is reached only by
    // approveManualContribution. No Settlement, Refund, Escrow release,
    // reconciliation, or Impact breakdown names the account at all, so there
    // is no second door into it.
    const mentions = appFiles().filter((file) => /PROGRAM_BALANCE/.test(source(file)));

    expect(mentions.sort()).toEqual([
      'src/lib/money/ledger.ts',
      'src/lib/money/manual-contributions.ts',
    ]);
  });

  it('refuses a Payout-shaped subject that is a Program, at the type the Payout path is written against', () => {
    // LedgerSubject -- the type every Payout, Refund and Escrow call is
    // written against -- has two variants and no Program one. This is the
    // reason ManualContributionSubject is a separate type rather than a third
    // member of LedgerSubject.
    const ledger = source('src/lib/money/ledger.ts');
    const ledgerSubject = /export type LedgerSubject =([\s\S]*?);\n/.exec(ledger);

    expect(ledgerSubject).not.toBeNull();
    expect(ledgerSubject![1]).toMatch(/type: 'campaign'/);
    expect(ledgerSubject![1]).toMatch(/type: 'trip'/);
    expect(ledgerSubject![1]).not.toMatch(/program/i);
  });

  it('offers no way to name a Volunteer Trip as a Manual Contribution target', () => {
    // A Trip Fee is money a Volunteer pays for their own seat, and it has
    // its own Payout path. Money recorded off-gateway must not be able to top
    // one up, so the Manual Contribution subject has no trip variant.
    const ledger = source('src/lib/money/ledger.ts');
    const manualSubject = /export type ManualContributionSubject =([\s\S]*?);\n/.exec(ledger);

    expect(manualSubject).not.toBeNull();
    expect(manualSubject![1]).toMatch(/type: 'campaign'/);
    expect(manualSubject![1]).toMatch(/type: 'program'/);
    expect(manualSubject![1]).not.toMatch(/type: 'trip'/);
  });
});
