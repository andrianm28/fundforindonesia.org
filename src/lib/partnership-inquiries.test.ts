import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The Partnership Inquiry seam (ticket 05): a company submits an Inquiry about
 * an existing Program through createPartnershipInquiry, and the partnership
 * team is notified through the existing Mailer. The database is a tiny
 * in-memory stand-in for the `program` and `partnershipInquiry` models; tests
 * assert on the Inquiry returned, the rows left behind, and the messages the
 * Mailer was handed -- never on which Prisma methods were called.
 */
import {
  createPartnershipInquiry,
  partnershipInquiryErrorToHttp,
  PARTNERSHIP_TEAM_EMAIL_ENV,
  INITIAL_INQUIRY_STATUS,
  PartnershipInquiryProgramNotFoundError,
  InvalidPartnershipInquiryInputError,
  type PartnershipInquiryCreateInput,
} from './partnership-inquiries';
import { MockMailer } from './mail/mock-mailer';
import { MailerNotConfiguredError } from './mail';

type ProgramRow = { id: string; title: string; slug: string; sector: string };
type InquiryRow = {
  id: string;
  programId: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  needs: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function makeDb(programs: ProgramRow[] = [{ id: 'program-1', title: 'Klinik Keliling Pesisir', slug: 'klinik-keliling-pesisir', sector: 'HEALTH' }]) {
  const inquiries: InquiryRow[] = [];
  const db = {
    programs: [...programs],
    inquiries,
    program: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        const row = programs.find((p) => p.id === where.id);
        return row ? { ...row } : null;
      },
    },
    partnershipInquiry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `inquiry-${inquiries.length + 1}`,
          contactPhone: null,
          ...data,
          createdAt: new Date('2026-09-27T00:00:00Z'),
          updatedAt: new Date('2026-09-27T00:00:00Z'),
        } as InquiryRow;
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
  contactPhone: '+62 812 3456 7890',
  needs: 'Kami ingin mendanai logistic dan mobilitas tim kesehatan untuk 12 bulan.',
};

let mailer: MockMailer;

beforeEach(() => {
  vi.stubEnv(PARTNERSHIP_TEAM_EMAIL_ENV, 'kemitraan@contoh.test');
  vi.stubEnv('NODE_ENV', 'test');
  mailer = new MockMailer();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('createPartnershipInquiry', () => {
  it('records the inquiry against the Program it is about', async () => {
    const { db, inquiries } = makeDb();

    const inquiry = await createPartnershipInquiry(db as never, VALID, mailer);

    expect(inquiry).toEqual(
      expect.objectContaining({
        programId: 'program-1',
        companyName: 'PT Sinar Abadi',
        contactName: 'Rina Wijaya',
        contactEmail: 'rina@sinarabadi.test',
        contactPhone: '+62 812 3456 7890',
        needs: VALID.needs,
      }),
    );
    expect(inquiries).toHaveLength(1);
  });

  it('starts the follow-up status at not-yet-followed-up, whatever the company sent', async () => {
    const { db } = makeDb();

    const inquiry = await createPartnershipInquiry(
      db as never,
      { ...VALID, status: 'DONE' } as PartnershipInquiryCreateInput,
      mailer,
    );

    expect(inquiry.status).toBe('NOT_YET_FOLLOWED_UP');
    expect(INITIAL_INQUIRY_STATUS).toBe('NOT_YET_FOLLOWED_UP');
  });

  it('notifies the partnership team through the Mailer', async () => {
    const { db } = makeDb();

    await createPartnershipInquiry(db as never, VALID, mailer);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toEqual(
      expect.objectContaining({ to: 'kemitraan@contoh.test', subject: expect.stringContaining('PT Sinar Abadi') }),
    );
    expect(mailer.sent[0].text).toContain('Klinik Keliling Pesisir');
    expect(mailer.sent[0].text).toContain('rina@sinarabadi.test');
    expect(mailer.sent[0].text).toContain('/admin/partnership-inquiries/inquiry-1');
  });

  it('refuses a Program that does not exist, writing nothing and mailing nobody', async () => {
    const { db, inquiries } = makeDb([]);

    const refusal = await createPartnershipInquiry(db as never, { ...VALID, programId: 'program-hilang' }, mailer).catch(
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(PartnershipInquiryProgramNotFoundError);
    expect(partnershipInquiryErrorToHttp(refusal)).toEqual({
      status: 404,
      error: 'Program yang ditanyakan tidak ditemukan.',
    });
    expect(inquiries).toHaveLength(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('keeps the inquiry when the Mailer refuses it, saying so out loud', async () => {
    const { db, inquiries } = makeDb();
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      errors.push(String(line));
    });
    const broken = {
      name: 'broken',
      send: async () => {
        throw new Error('provider down');
      },
    };

    const inquiry = await createPartnershipInquiry(db as never, VALID, broken);

    expect(inquiry.id).toBe('inquiry-1');
    expect(inquiries).toHaveLength(1);
    expect(errors.join('\n')).toContain('mail_send_failed');
    expect(errors.join('\n')).toContain('inquiry-1');
  });

  it('does not put the recipient address in the log line when the Mailer fails', async () => {
    const { db } = makeDb();
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    await createPartnershipInquiry(db as never, VALID, {
      name: 'broken',
      send: async () => {
        throw new Error('provider down');
      },
    });

    expect(lines.join('\n')).not.toContain('kemitraan@contoh.test');
  });
});

describe('partnershipTeamRecipient', () => {
  it('fails loudly in production when the address is not configured', async () => {
    const { partnershipTeamRecipient } = await import('./partnership-inquiries');
    vi.stubEnv(PARTNERSHIP_TEAM_EMAIL_ENV, undefined);
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => partnershipTeamRecipient()).toThrow(MailerNotConfiguredError);
    expect(() => partnershipTeamRecipient()).toThrow(PARTNERSHIP_TEAM_EMAIL_ENV);
  });

  it('refuses an address that is not an address', async () => {
    const { partnershipTeamRecipient } = await import('./partnership-inquiries');
    vi.stubEnv(PARTNERSHIP_TEAM_EMAIL_ENV, 'bukan-alamat');
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => partnershipTeamRecipient()).toThrow(MailerNotConfiguredError);
  });

  it('has no address at all in development, where the mock Mailer delivers nowhere', async () => {
    const { partnershipTeamRecipient } = await import('./partnership-inquiries');
    vi.stubEnv(PARTNERSHIP_TEAM_EMAIL_ENV, undefined);
    vi.stubEnv('NODE_ENV', 'development');

    expect(partnershipTeamRecipient()).toBeNull();
  });

  it('leaves the inquiry standing when production has no address to send to', async () => {
    const { db, inquiries } = makeDb();
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    vi.stubEnv(PARTNERSHIP_TEAM_EMAIL_ENV, undefined);
    vi.stubEnv('NODE_ENV', 'production');

    const inquiry = await createPartnershipInquiry(db as never, VALID, mailer);

    expect(inquiry.id).toBe('inquiry-1');
    expect(inquiries).toHaveLength(1);
    expect(mailer.sent).toHaveLength(0);
    expect(lines.join('\n')).toContain('mail_not_configured');
  });

  it('mails nobody in development when no address is configured, and says nothing', async () => {
    const { db, inquiries } = makeDb();
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    vi.stubEnv(PARTNERSHIP_TEAM_EMAIL_ENV, undefined);
    vi.stubEnv('NODE_ENV', 'development');

    const inquiry = await createPartnershipInquiry(db as never, VALID, mailer);

    expect(inquiry.id).toBe('inquiry-1');
    expect(inquiries).toHaveLength(1);
    expect(mailer.sent).toHaveLength(0);
    expect(lines).toEqual([]);
  });
});

describe('createPartnershipInquiry input', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(PARTNERSHIP_TEAM_EMAIL_ENV, undefined);
  });

  it.each([
    ['no Program named', { programId: undefined }, 'Program yang ditanyakan wajib diisi.'],
    ['a blank company name', { companyName: '   ' }, 'Nama perusahaan wajib diisi.'],
    ['no contact name', { contactName: undefined }, 'Nama narahubung wajib diisi.'],
    ['no email', { contactEmail: undefined }, 'Email narahubung wajib diisi.'],
    ['an address that is not one', { contactEmail: 'rina(at)sinarabadi.test' }, 'Email narahubung tidak valid.'],
    ['no needs description', { needs: '' }, 'Kebutuhan yang disampaikan wajib diisi.'],
    ['a company name far too long', { companyName: 'a'.repeat(201) }, 'Nama perusahaan paling panjang 200 karakter.'],
    ['a needs description far too long', { needs: 'a'.repeat(5001) }, 'Kebutuhan yang disampaikan paling panjang 5000 karakter.'],
    ['a phone number that is not text', { contactPhone: 8123456789 }, 'Telepon harus berupa teks.'],
    ['a Program id far too long to be one', { programId: 'a'.repeat(101) }, 'Program yang ditanyakan tidak valid.'],
  ])('refuses %s, writing nothing and mailing nobody', async (_name, override, message) => {
    const { db, inquiries } = makeDb();

    const refusal = await createPartnershipInquiry(db as never, { ...VALID, ...override }, mailer).catch(
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(InvalidPartnershipInquiryInputError);
    expect(partnershipInquiryErrorToHttp(refusal)).toEqual({ status: 400, error: message });
    expect(inquiries).toHaveLength(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('trims what it stores, so a stray space cannot make two companies look different', async () => {
    const { db } = makeDb();

    const inquiry = await createPartnershipInquiry(
      db as never,
      { ...VALID, companyName: '  PT Sinar Abadi  ', contactEmail: ' rina@sinarabadi.test ' },
      mailer,
    );

    expect(inquiry.companyName).toBe('PT Sinar Abadi');
    expect(inquiry.contactEmail).toBe('rina@sinarabadi.test');
  });

  it('stores no phone at all when the company gave none', async () => {
    const { db } = makeDb();

    const inquiry = await createPartnershipInquiry(db as never, { ...VALID, contactPhone: undefined }, mailer);

    expect(inquiry.contactPhone).toBeNull();
  });

  it('leaves an unknown error to its own caller', () => {
    expect(partnershipInquiryErrorToHttp(new Error('kabel putus'))).toBeNull();
  });
});
