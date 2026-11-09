// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPartnershipInquiry,
  InvalidPartnershipInquiryInputError,
  PARTNERSHIP_TEAM_EMAIL_ENV,
  type PartnershipInquiryCreateInput,
} from './partnership-inquiries';
import { readInquiryCompanyAddress, readInquiryCompanyNpwp } from './contact-fields';
import { MockMailer } from './mail/mock-mailer';

/**
 * pks-pemenuhan/17 (PKS Pasal 3.6): the extra fields of the full collaboration
 * form. Budget is a choice of range, the period is a start and end month, the
 * company address and NPWP are optional and sealed like the contact phone.
 */

function makeDb() {
  const inquiries: Record<string, unknown>[] = [];
  const db = {
    program: {
      findUnique: async () => ({ id: 'program-1', title: 'Klinik Keliling Pesisir', sector: 'HEALTH' }),
    },
    partnershipInquiry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `inquiry-${inquiries.length + 1}`, ...data };
        inquiries.push(row);
        return { ...row };
      },
    },
  };
  return { db, inquiries };
}

const VALID: PartnershipInquiryCreateInput = {
  programId: 'program-1',
  companyName: 'PT Sinar Abadi',
  contactName: 'Rina Wijaya',
  contactEmail: 'rina@sinarabadi.test',
  needs: 'Kami ingin mendanai mobilitas tim kesehatan.',
};

// Obviously fake, built at runtime: a run of zeros is nobody's NPWP.
const FAKE_NPWP = '0'.repeat(15);
const EXTRA = {
  budgetRange: 'FROM_50M_TO_250M',
  periodStart: '2027-01',
  periodEnd: '2027-06',
  companyAddress: 'Jl. Contoh Nomor 1, Kota Contoh',
  companyNpwp: `${'00'}.${'000'}.${'000'}.${'0'}-${'000'}.${'000'}`,
};

let mailer: MockMailer;

beforeEach(() => {
  vi.stubEnv(PARTNERSHIP_TEAM_EMAIL_ENV, 'kemitraan@contoh.test');
  vi.stubEnv('NODE_ENV', 'test');
  mailer = new MockMailer();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createPartnershipInquiry extra fields (pks-pemenuhan/17)', () => {
  it('stores the budget range and period as chosen', async () => {
    const { db } = makeDb();

    const inquiry = await createPartnershipInquiry(db as never, { ...VALID, ...EXTRA }, mailer);

    expect(inquiry).toEqual(
      expect.objectContaining({ budgetRange: 'FROM_50M_TO_250M', periodStart: '2027-01', periodEnd: '2027-06' }),
    );
  });

  it('seals the address and NPWP, and keeps neither in the clear', async () => {
    const { db, inquiries } = makeDb();

    const inquiry = await createPartnershipInquiry(db as never, { ...VALID, ...EXTRA }, mailer);

    expect(readInquiryCompanyAddress(inquiry as never)).toBe('Jl. Contoh Nomor 1, Kota Contoh');
    // Punctuation is dropped: the NPWP is stored as its digits.
    expect(readInquiryCompanyNpwp(inquiry as never)).toBe(FAKE_NPWP);
    const stored = JSON.stringify(inquiries[0]);
    expect(stored).not.toContain('Jl. Contoh');
    expect(stored).not.toContain(FAKE_NPWP);
  });

  it('treats all the new fields as optional', async () => {
    const { db } = makeDb();

    const inquiry = await createPartnershipInquiry(db as never, VALID, mailer);

    expect(inquiry).toEqual(expect.objectContaining({ budgetRange: null, periodStart: null, periodEnd: null }));
    expect(readInquiryCompanyAddress(inquiry as never)).toBeNull();
    expect(readInquiryCompanyNpwp(inquiry as never)).toBeNull();
  });

  it.each([
    ['a budget that is not one of the ranges', { budgetRange: '5000000' }],
    ['a period with only a start', { periodStart: '2027-01' }],
    ['a period with only an end', { periodEnd: '2027-06' }],
    ['a month that does not exist', { periodStart: '2027-13', periodEnd: '2027-14' }],
    ['a period that ends before it starts', { periodStart: '2027-06', periodEnd: '2027-01' }],
    ['an NPWP that is not 15 or 16 digits', { companyNpwp: '12345' }],
    ['an address that is too long', { companyAddress: 'x'.repeat(501) }],
  ])('refuses %s', async (_name, extra) => {
    const { db, inquiries } = makeDb();

    await expect(
      createPartnershipInquiry(db as never, { ...VALID, ...extra } as PartnershipInquiryCreateInput, mailer),
    ).rejects.toBeInstanceOf(InvalidPartnershipInquiryInputError);
    expect(inquiries).toEqual([]);
  });
});
