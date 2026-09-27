import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ticket 01's structural invariant: a Program is a CSR catalog item, never a
 * money subject. No Donation, Payment, Refund, Payout, or LedgerEntry may
 * reach a Program (no foreign key, no relation, no scalar), and the fixed
 * Sector enum lives apart from Campaign's Category table. This test reads
 * prisma/schema.prisma itself, so a later ticket that wires a Program id
 * into any money model fails here before it can take money online.
 */
const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');

function blockOf(kind: 'model' | 'enum', name: string): string {
  const match = new RegExp(`^${kind} ${name} \\{[\\s\\S]*?^\\}`, 'm').exec(schema);
  if (!match) throw new Error(`prisma/schema.prisma has no ${kind} ${name}`);
  return match[0];
}

/** A block without its comment lines: the invariant is about fields and relations, not prose. */
function uncommented(block: string): string {
  return block
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function enumValues(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Z_]*$/.test(line));
}

describe('Program money isolation (ticket 01)', () => {
  it('defines Sector as exactly the four fixed values', () => {
    expect(enumValues(blockOf('enum', 'Sector'))).toEqual([
      'HEALTH',
      'EDUCATION',
      'ENVIRONMENT',
      'DISABILITY_INCLUSION',
    ]);
  });

  it('gives Program a sector field and an off-books reported figure, but no Kind', () => {
    const program = uncommented(blockOf('model', 'Program'));

    expect(program).toMatch(/sector\s+Sector/);
    expect(program).toMatch(/reportedAmount\s+Int/);
    expect(program).not.toMatch(/kind/i);
  });

  it.each(['Donation', 'Payment', 'Refund', 'Payout', 'LedgerEntry'])(
    'lets no %s reach a Program',
    (model) => {
      expect(blockOf('model', model)).not.toMatch(/program/i);
    },
  );

  it('lets no Program reach back into money, escrow, or payout code', () => {
    const program = uncommented(blockOf('model', 'Program'));

    expect(program).not.toMatch(/donation|payment|payout|ledger|escrow|refund/i);
  });

  it('keeps Sector (Program) structurally separate from Category (Campaign)', () => {
    expect(schema).toMatch(/^model Category \{/m);
    expect(schema).toMatch(/^enum Sector \{/m);
    expect(blockOf('model', 'Program')).not.toMatch(/categor/i);
    expect(blockOf('model', 'Campaign')).not.toMatch(/sector/i);
  });
});
