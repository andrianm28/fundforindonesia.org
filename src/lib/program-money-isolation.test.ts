import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ticket 01's structural invariant: a Program is a CSR catalog item, never a
 * money subject. No Donation, Payment, Refund, or Payout may reach a Program
 * (no foreign key, no relation, no scalar), and the fixed Sector enum lives
 * apart from Campaign's Category table. This test reads prisma/schema.prisma
 * itself, so a later ticket that wires a Program id into any money model
 * fails here before it can take money online.
 *
 * ONE DELIBERATE EXCEPTION, added by prd-compliance 34. A Program can hold
 * CSR money that crossed the platform's own account, credited to the
 * PROGRAM_BALANCE ledger account (CONTEXT.md, Program Balance; PRD FFI-07c).
 * That is a Manual Contribution -- money an Admin recorded with proof of
 * transfer and a second Admin approved -- and it is not online money:
 *
 *  - PROGRAM_BALANCE is the only account a Program id can appear beside, and
 *    it is a leaf: nothing credits it but a Manual Contribution, and nothing
 *    spends it at all.
 *  - LedgerEntry carries the Program id as a BARE SCALAR with no @relation,
 *    so no money model holds a Prisma relation to Program and Program itself
 *    never has to name a ledger. The referential guarantee comes from
 *    ManualContribution.programId, a real foreign key written in the same
 *    transaction.
 *  - ManualContribution is the one model with a Program foreign key, and it
 *    is not a Donation, Payment, Refund or Payout: it cannot take money
 *    online, cannot be refunded, and cannot be paid out.
 *
 * The exception is a hole of exactly this shape. A later ticket that adds a
 * Program id to any other model, or a second program-scoped account, fails
 * the assertions below rather than quietly widening it.
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

  it.each(['Donation', 'Payment', 'Refund', 'Payout'])(
    'lets no %s reach a Program',
    (model) => {
      expect(blockOf('model', model)).not.toMatch(/program/i);
    },
  );

  it('lets LedgerEntry name a Program only as the bare column that scopes PROGRAM_BALANCE', () => {
    const entry = uncommented(blockOf('model', 'LedgerEntry'));

    // The one column, a plain scalar. A @relation here would force a
    // back-relation onto Program and put the word "ledger" on a catalog row.
    expect(entry).toMatch(/programId\s+String\?/);
    expect(entry).not.toMatch(/program\s+Program\??\s*@relation/);
    expect(entry).not.toMatch(/program\w*\s+Program\[\]/);
  });

  it('makes PROGRAM_BALANCE the only account a Program can hold money in', () => {
    const accounts = enumValues(blockOf('enum', 'LedgerAccount'));
    const programScoped = accounts.filter((value) => value.includes('PROGRAM'));

    expect(programScoped).toEqual(['PROGRAM_BALANCE']);
  });

  it('keeps the ManualContribution relation one-directional: money names a Program, never the reverse', () => {
    // Exactly two models carry a Program column, and only one of them treats
    // it as a foreign key. ManualContribution is a write; LedgerEntry's is the
    // bare scope column the assertion above pins.
    const models = ['Donation', 'Payment', 'Refund', 'Payout', 'LedgerEntry', 'ManualContribution'];
    const withProgramColumn = models.filter((model) =>
      uncommented(blockOf('model', model)).match(/programId\s+String\?/),
    );
    expect(withProgramColumn).toEqual(['LedgerEntry', 'ManualContribution']);

    // The relation has to be the very next line: matching "@relation" within
    // some window of the column would also catch LedgerEntry's unrelated
    // ManualContribution relation further down its block.
    const withProgramRelation = models.filter((model) =>
      uncommented(blockOf('model', model)).match(/programId\s+String\?\s*\n\s*program\s+Program\?/),
    );
    // A real foreign key means the database refuses a contribution against a
    // Program that does not exist. It lives here and nowhere else.
    expect(withProgramRelation).toEqual(['ManualContribution']);

    const program = uncommented(blockOf('model', 'Program'));
    // The back-relation is inert: a list, with no money model named.
    expect(program).toMatch(/manualContributions\s+ManualContribution\[\]/);
  });

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

/**
 * The same invariant one step along (ticket 05): a Partnership Inquiry is a
 * conversation about a Program, not an entity that can hold money or be paid.
 * ADR 0002 says the whole of a Campaign's online money lives on the Campaign;
 * an Inquiry is not a Campaign, so it must reach none of it either.
 */
describe('PartnershipInquiry money isolation (ticket 05)', () => {
  it('points at one Program, optionally one Company and one PIC, plus the log of its own follow-up steps', () => {
    const inquiry = uncommented(blockOf('model', 'PartnershipInquiry'));

    expect(inquiry).toMatch(/programId\s+String/);
    // The only @relation is the one naming the Program. Ticket 06 added a
    // second, relation-shaped field -- the Inquiry's own follow-up trail --
    // which is a list of its own log, not a foreign key to anything else, and
    // so carries no @relation of its own. E9/01 tahap 2 added the second
    // @relation: the optional Company a Tim CSR member filed it for. A Company
    // is a name and an email domain, never money. pks-pemenuhan/17 added the
    // third: the optional PIC, an Admin User who owns the follow-up -- a person,
    // never an account that holds money. The proposal PDF is a Document that
    // points AT the Inquiry (`documents Document[]`), so it adds no @relation here.
    expect(inquiry.match(/@relation/g)).toHaveLength(3);
    expect(inquiry).toMatch(/program\s+Program\s+@relation/);
    expect(inquiry).toMatch(/company\s+Company\?\s+@relation/);
    expect(inquiry).toMatch(/pic\s+User\?\s+@relation/);
    expect(uncommented(blockOf('model', 'Company'))).not.toMatch(/amount|balance|kind|escrow|ledger/i);
    expect(inquiry).toMatch(/statusChanges\s+PartnershipInquiryStatusChange\[\]/);
  });

  it.each(['Donation', 'Payment', 'Refund', 'Payout', 'LedgerEntry'])(
    'is named by no %s',
    (model) => {
      expect(blockOf('model', model)).not.toMatch(/partnershipinquiry|partnershipInquiry/i);
    },
  );

  it('carries no money column and no Kind of its own', () => {
    const inquiry = uncommented(blockOf('model', 'PartnershipInquiry'));

    expect(inquiry).not.toMatch(/amount|balance|kind|escrow|ledger/i);
  });

  it('starts every Inquiry at Baru, with the eight stages of PKS Pasal 3.6', () => {
    expect(blockOf('model', 'PartnershipInquiry')).toMatch(/status\s+PartnershipInquiryStatus\s+@default\(NEW\)/);
    expect(enumValues(blockOf('enum', 'PartnershipInquiryStatus'))).toEqual([
      'NEW',
      'CONTACTED',
      'PROPOSAL',
      'NEGOTIATION',
      'APPROVED',
      'ONGOING',
      'DONE',
      'DROPPED',
    ]);
  });
});

/**
 * One step along (ticket 06): recording who followed an Inquiry up, and when,
 * reaches no money either. A follow-up status says where the partnership
 * team's conversation stands; it never says a Program may be given to, and
 * nothing may turn a logged follow-up into money moved.
 */
describe('PartnershipInquiryStatusChange money isolation (ticket 06)', () => {
  it('names only the Inquiry it belongs to, the person who moved it and the PICs it moved between', () => {
    const change = uncommented(blockOf('model', 'PartnershipInquiryStatusChange'));

    expect(change).toMatch(/inquiry\s+PartnershipInquiry\s+@relation/);
    expect(change).toMatch(/actedBy\s+User\s+@relation/);
    // pks-pemenuhan/17: a change may also record the PIC it took the Inquiry from
    // and gave it to -- two more people, still no money.
    expect(change).toMatch(/picFrom\s+User\?\s+@relation/);
    expect(change).toMatch(/picTo\s+User\?\s+@relation/);
    expect(change.match(/@relation/g)).toHaveLength(4);
    expect(change).not.toMatch(/amount|balance|escrow|ledger/i);
    // A follow-up records who and when; it decides nothing on its own.
    expect(change).not.toMatch(/kind|program|capacity|reason/i);
  });

  it('never loses a follow-up to a delete of the Inquiry or of the person', () => {
    const change = blockOf('model', 'PartnershipInquiryStatusChange');

    // The Inquiry and the actor are never deleted out from under the log. The
    // two PIC pointers are only names for display and may be cleared to null
    // when that person is removed; the row itself, with who acted and when, stays.
    expect(change.match(/onDelete: Restrict/g)).toHaveLength(2);
    expect(change.match(/onDelete: SetNull/g)).toHaveLength(2);
  });
});
