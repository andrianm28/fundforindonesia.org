// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { sealUserEmail } from '@/lib/contact-fields';

/**
 * Tim CSR accounts against a REAL Postgres (ticket E9/01, tahap 2; decisions of
 * 2026-10-04): a person joins a company by email domain, a verified member files
 * and reads the company's Partnership Inquiries and downloads the impact report
 * of its funded Programs, nobody else can see any of it, and the retention job
 * anonymises a company two years after its last activity. Same setup as
 * finance-recap-real-db.test.ts: a throwaway database migrated by replaying
 * every migration, and a visible skip when TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Tim CSR accounts -- against real Postgres (E9/01 tahap 2)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[tim csr] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `tim_csr_${process.pid}`;
  let prisma: PrismaClient;
  let session: { user: { id: string; assignments: string[] } } | null = null;
  let lib: typeof import('@/lib/tim-csr');
  let followUp: typeof import('@/lib/partnership-inquiry-followup');
  let membershipRoute: typeof import('@/app/api/csr/membership/route');
  let inquiriesRoute: typeof import('@/app/api/csr/inquiries/route');
  let reportRoute: typeof import('@/app/api/csr/impact-report/route');
  let mails: Array<{ to: string; replyTo?: string }> = [];

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await admin.end();

    const url = databaseUrlFor(databaseName);
    const migrator = new Client({ connectionString: url });
    await migrator.connect();
    try {
      const dirs = readdirSync(MIGRATIONS_DIR)
        .filter((d) => !d.startsWith('migration_lock'))
        .sort();
      for (const dir of dirs) await migrator.query(readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
    } finally {
      await migrator.end();
    }

    const adapter = new PrismaPg({ connectionString: url });
    const { PrismaClient: RealPrismaClient } = await import('@/generated/prisma/client');
    prisma = new RealPrismaClient({ adapter });
    vi.doMock('@/lib/prisma', () => ({ prisma }));
    vi.doMock('@/lib/auth', () => ({ getServerSession: async () => session }));
    vi.doMock('@/lib/mail', async (importOriginal) => {
      const original = await importOriginal<typeof import('@/lib/mail')>();
      return {
        ...original,
        sendReportingFailure: async (message: { to: string; replyTo?: string }) => {
          mails.push({ to: message.to, replyTo: message.replyTo });
        },
      };
    });
    lib = await import('@/lib/tim-csr');
    followUp = await import('@/lib/partnership-inquiry-followup');
    membershipRoute = await import('@/app/api/csr/membership/route');
    inquiriesRoute = await import('@/app/api/csr/inquiries/route');
    reportRoute = await import('@/app/api/csr/impact-report/route');
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await prisma?.$disconnect();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  let counter = 0;

  async function makeUser(email: string, opts: { verified?: boolean; name?: string } = {}): Promise<string> {
    const id = `u-${process.pid}-${counter++}`;
    await prisma.user.create({
      data: {
        id,
        name: opts.name ?? `Orang ${id}`,
        ...sealUserEmail(email),
        emailVerifiedAt: opts.verified === false ? null : new Date('2026-10-01T00:00:00Z'),
      },
    });
    return id;
  }

  async function makeProgram(slug: string, extra: Record<string, unknown> = {}): Promise<string> {
    const program = await prisma.program.create({
      data: {
        slug,
        title: `Program ${slug}`,
        sector: 'HEALTH',
        problem: 'Masalah',
        beneficiaries: '200 anak',
        location: 'Kupang',
        activities: 'Klinik keliling',
        budget: 100_000_000,
        timeline: 'Jan-Des 2027',
        kpis: ['200 anak diperiksa'],
        impactReport: `Laporan dampak ${slug}`,
        ...extra,
      },
    });
    return program.id;
  }

  function as(userId: string | null) {
    session = userId ? { user: { id: userId, assignments: [] } } : null;
  }

  function post(path: string, body: unknown) {
    return new NextRequest(`http://localhost${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  async function joinAs(userId: string, companyName?: string) {
    as(userId);
    return membershipRoute.POST(post('/api/csr/membership', companyName ? { companyName } : {}));
  }

  async function file(userId: string, programId: string, needs: string) {
    as(userId);
    return inquiriesRoute.POST(post('/api/csr/inquiries', { programId, needs }));
  }

  describe('joining a company', () => {
    it('a verified person on a company domain creates the company and is its verified member', async () => {
      const user = await makeUser('sari@acme-join.co.id');
      const res = await joinAs(user, 'Acme Join');
      expect(res.status).toBe(201);
      expect((await res.json()).membership).toMatchObject({ companyName: 'Acme Join', verified: true });
      const company = await prisma.company.findUniqueOrThrow({ where: { emailDomain: 'acme-join.co.id' } });
      expect(company.name).toBe('Acme Join');
    });

    it('a second person on the same domain joins the same company', async () => {
      const second = await makeUser('andi@acme-join.co.id');
      const res = await joinAs(second);
      expect(res.status).toBe(200);
      expect((await prisma.company.count({ where: { emailDomain: 'acme-join.co.id' } }))).toBe(1);
      expect(await prisma.companyMembership.count({ where: { company: { emailDomain: 'acme-join.co.id' } } })).toBe(2);
    });

    it('a free-mail address cannot make a company', async () => {
      const user = await makeUser('seseorang@gmail.com');
      const res = await joinAs(user, 'Perusahaan Gmail');
      expect(res.status).toBe(400);
      expect(await prisma.company.count({ where: { emailDomain: 'gmail.com' } })).toBe(0);
    });

    it('a person whose email is not verified gets the same 403 whether or not the company exists, and learns nothing', async () => {
      const founder = await makeUser('eko@pending-co.co.id');
      await joinAs(founder, 'Pending Co Rahasia');
      const unverifiedAtExisting = await makeUser('fitri@pending-co.co.id', { verified: false });
      const unverifiedAtNew = await makeUser('dewi@belum-verifikasi.co.id', { verified: false });

      const atExisting = await joinAs(unverifiedAtExisting);
      const atNew = await joinAs(unverifiedAtNew, 'Belum Verifikasi');
      expect(atExisting.status).toBe(403);
      expect(atNew.status).toBe(403);
      expect(await atExisting.text()).not.toContain('Pending Co');
      expect(await atNew.text()).not.toContain('Belum Verifikasi');
      expect(await prisma.companyMembership.count({ where: { userId: { in: [unverifiedAtExisting, unverifiedAtNew] } } })).toBe(0);
      expect(await prisma.company.count({ where: { emailDomain: 'belum-verifikasi.co.id' } })).toBe(0);

      // Once the address is verified the same person can join and sees the company.
      await prisma.user.update({ where: { id: unverifiedAtExisting }, data: { emailVerifiedAt: new Date() } });
      expect((await joinAs(unverifiedAtExisting)).status).toBe(200);
      as(unverifiedAtExisting);
      expect((await inquiriesRoute.GET()).status).toBe(200);
    });

    it('a stale membership whose email no longer matches the company gets a 404 with no company data', async () => {
      const founder = await makeUser('ani@stale-co.co.id');
      await joinAs(founder, 'Stale Co');
      const mover = await makeUser('budi@other-co.co.id');
      const stale = await prisma.company.findUniqueOrThrow({ where: { emailDomain: 'stale-co.co.id' } });
      await prisma.companyMembership.create({ data: { companyId: stale.id, userId: mover } });
      const res = await joinAs(mover, 'Other Co');
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('Stale Co');
    });

    it('reactivating an anonymised company starts it clean and retention does not undo it', async () => {
      const programId = await makeProgram('program-reaktivasi');
      const old = await makeUser('lama@reaktif.co.id', { name: 'Orang Lama Reaktif' });
      await joinAs(old, 'Reaktif Lama');
      await file(old, programId, 'Inquiry lama');
      const company = await prisma.company.findUniqueOrThrow({ where: { emailDomain: 'reaktif.co.id' } });
      const long_ago = new Date('2020-01-01T00:00:00Z');
      await prisma.partnershipInquiry.updateMany({ where: { companyId: company.id }, data: { createdAt: long_ago } });
      await prisma.company.update({ where: { id: company.id }, data: { createdAt: long_ago } });
      await prisma.companyMembership.updateMany({ where: { companyId: company.id }, data: { createdAt: long_ago } });
      await lib.anonymiseExpiredCompanies(prisma, new Date());
      expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).anonymisedAt).not.toBeNull();

      const fresh = await makeUser('baru@reaktif.co.id');
      const res = await joinAs(fresh, 'Reaktif Baru');
      expect(res.status).toBe(201);
      await lib.anonymiseExpiredCompanies(prisma, new Date(Date.now() + 24 * 3600 * 1000));
      const after = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
      expect(after.anonymisedAt).toBeNull();
      expect(after.name).toBe('Reaktif Baru');
      as(fresh);
      const body = await (await inquiriesRoute.GET()).json();
      expect(body.inquiries).toHaveLength(0);
    });

    it('joining without a company name is refused when there is no company to join', async () => {
      const user = await makeUser('x@belum-ada.co.id');
      expect((await joinAs(user)).status).toBe(400);
    });

    it('an anonymous visitor gets 401 from the join route', async () => {
      as(null);
      expect((await membershipRoute.POST(post('/api/csr/membership', { companyName: 'X' }))).status).toBe(401);
    });
  });

  describe('inquiries, history and privacy between companies', () => {
    it('a member files an Inquiry tied to the company, confirmed to the member with the team notified', async () => {
      const programId = await makeProgram('klinik-a');
      const member = await makeUser('rina@alpha.co.id', { name: 'Rina Alpha' });
      await joinAs(member, 'Alpha');
      mails = [];
      const res = await file(member, programId, 'Kami ingin mendanai klinik ini.');
      expect(res.status).toBe(201);
      const row = await prisma.partnershipInquiry.findFirstOrThrow({ where: { company: { emailDomain: 'alpha.co.id' } } });
      expect(row.companyName).toBe('Alpha');
      expect(row.contactName).toBe('Rina Alpha');
      expect(row.status).toBe('NEW');
      expect(mails.some((m) => m.to === 'rina@alpha.co.id')).toBe(true);
    });

    it('a company sees its own Inquiries with their status history and nobody else\'s', async () => {
      const programId = await makeProgram('klinik-b');
      const alpha = await makeUser('budi@alpha.co.id');
      await joinAs(alpha);
      const beta = await makeUser('citra@beta.co.id');
      await joinAs(beta, 'Beta');
      await file(beta, programId, 'Rahasia Beta: anggaran kami 5 miliar.');

      const betaInquiry = await prisma.partnershipInquiry.findFirstOrThrow({ where: { company: { emailDomain: 'beta.co.id' } } });
      const admin = await makeUser('admin@platform.example');
      await followUp.updatePartnershipInquiry(prisma, { inquiryId: betaInquiry.id, status: 'CONTACTED', actorId: admin });

      as(beta);
      const betaBody = await (await inquiriesRoute.GET()).json();
      expect(betaBody.inquiries).toHaveLength(1);
      expect(betaBody.inquiries[0].status).toBe('CONTACTED');
      expect(betaBody.inquiries[0].history.map((h: { status: string }) => h.status)).toEqual([
        'NEW',
        'CONTACTED',
      ]);
      expect(JSON.stringify(betaBody)).not.toContain(admin);

      as(alpha);
      const alphaText = await (await inquiriesRoute.GET()).text();
      expect(alphaText).not.toContain('Rahasia Beta');
      expect(alphaText).not.toContain('beta.co.id');
      expect(alphaText).not.toContain(betaInquiry.id);
    });

    it('a non-member and an anonymous visitor get a literal 404 from the member routes', async () => {
      const stranger = await makeUser('orang@tanpa-perusahaan.co.id');
      for (const who of [stranger, null]) {
        as(who);
        for (const res of [
          await inquiriesRoute.GET(),
          await inquiriesRoute.POST(post('/api/csr/inquiries', { programId: 'x', needs: 'y' })),
          await reportRoute.GET(),
        ]) {
          expect(res.status).toBe(404);
        }
      }
    });

    it('a member cannot file against a Program that does not exist', async () => {
      const member = await makeUser('gita@gamma.co.id');
      await joinAs(member, 'Gamma');
      expect((await file(member, 'tidak-ada', 'Halo')).status).toBe(404);
    });

    it('a company cannot be reached by naming its id in the body', async () => {
      const programId = await makeProgram('klinik-c');
      const member = await makeUser('hadi@delta.co.id');
      await joinAs(member, 'Delta');
      const alphaCompany = await prisma.company.findUniqueOrThrow({ where: { emailDomain: 'alpha.co.id' } });
      as(member);
      await inquiriesRoute.POST(post('/api/csr/inquiries', { programId, needs: 'Halo', companyId: alphaCompany.id }));
      const row = await prisma.partnershipInquiry.findFirstOrThrow({ where: { needs: 'Halo', programId } });
      expect(row.companyId).not.toBe(alphaCompany.id);
    });

    it('the public form still records an Inquiry that belongs to no company, even if the body names one', async () => {
      const programId = await makeProgram('klinik-d');
      const { createPartnershipInquiry } = await import('@/lib/partnership-inquiries');
      const company = await prisma.company.findUniqueOrThrow({ where: { emailDomain: 'alpha.co.id' } });
      const created = await createPartnershipInquiry(
        prisma,
        { programId, companyName: 'Publik', contactName: 'P', contactEmail: 'p@publik.example', needs: 'n', companyId: company.id } as never,
        { send: async () => undefined } as never,
      );
      expect(created.companyId).toBeNull();
    });
  });

  describe('impact report', () => {
    it('contains only Programs of the company\'s finished Inquiries, with Program data and no donor data', async () => {
      const funded = await makeProgram('program-dibiayai', {
        reportedAmount: 25_000_000,
        reportedAsOf: new Date('2026-10-15T00:00:00Z'),
        reportedNote: 'Dari Budi Donor, budi.donor@rahasia.example, 0812-RAHASIA',
      });
      const notFunded = await makeProgram('program-belum');
      const other = await makeProgram('program-perusahaan-lain');
      const recorder = await makeUser('recorder@platform.example');
      await prisma.manualContribution.create({
        data: {
          amount: 9_999_999,
          programId: funded,
          proofReference: 'bukti',
          note: 'Donor: Budi Donor 0812-RAHASIA',
          recordedById: recorder,
        },
      });

      const member = await makeUser('ika@epsilon.co.id');
      await joinAs(member, 'Epsilon');
      const rival = await makeUser('jaya@zeta.co.id');
      await joinAs(rival, 'Zeta');
      await file(member, funded, 'Danai ini');
      await file(member, notFunded, 'Tanya ini');
      await file(rival, other, 'Milik Zeta');

      const admin = await makeUser('admin2@platform.example');
      const inquiries = await prisma.partnershipInquiry.findMany({
        where: { OR: [{ programId: funded }, { programId: other }] },
      });
      for (const inquiry of inquiries) {
        await followUp.updatePartnershipInquiry(prisma, { inquiryId: inquiry.id, status: 'CONTACTED', actorId: admin });
        await followUp.updatePartnershipInquiry(prisma, { inquiryId: inquiry.id, status: 'DONE', actorId: admin });
      }

      as(member);
      const res = await reportRoute.GET();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="laporan-dampak-epsilon/);
      const text = await res.text();
      expect(text).toContain('Program program-dibiayai');
      expect(text).toContain('Laporan dampak program-dibiayai');
      expect(text).toContain('Total dana yang tercatat pada Program ini (bukan kontribusi perusahaan)');
      expect(text).not.toContain('Program program-belum');
      expect(text).not.toContain('Program program-perusahaan-lain');
      for (const secret of ['Budi Donor', 'budi.donor', 'RAHASIA', '9.999.999', '9999999', 'ika@epsilon']) {
        expect(text).not.toContain(secret);
      }
    });
  });

  describe('retention', () => {
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

    it('anonymises a company two years after its last activity and not before', async () => {
      const programId = await makeProgram('program-retensi');
      const member = await makeUser('lia@eta.co.id', { name: 'Lia Eta' });
      await joinAs(member, 'Eta');
      await file(member, programId, 'Kebutuhan Eta');
      const company = await prisma.company.findUniqueOrThrow({ where: { emailDomain: 'eta.co.id' } });
      const filedAt = new Date('2026-01-01T00:00:00Z');
      await prisma.partnershipInquiry.updateMany({ where: { companyId: company.id }, data: { createdAt: filedAt } });
      await prisma.company.update({ where: { id: company.id }, data: { createdAt: filedAt } });
      await prisma.companyMembership.updateMany({ where: { companyId: company.id }, data: { createdAt: filedAt } });

      const early = await lib.anonymiseExpiredCompanies(prisma, new Date(filedAt.getTime() + 2 * YEAR_MS - 24 * 3600 * 1000));
      expect(early.anonymisedCount).toBe(0);
      expect((await prisma.partnershipInquiry.findFirstOrThrow({ where: { companyId: company.id } })).contactName).toBe('Lia Eta');

      const late = await lib.anonymiseExpiredCompanies(prisma, new Date(filedAt.getTime() + 2 * YEAR_MS + 2 * 24 * 3600 * 1000));
      expect(late.anonymisedCount).toBe(1);

      const inquiry = await prisma.partnershipInquiry.findFirstOrThrow({ where: { companyId: company.id } });
      expect(inquiry.contactName).not.toContain('Lia');
      expect(inquiry.contactAnonymisedAt).not.toBeNull();
      expect(inquiry.contactPhoneCiphertext).toBeNull();
      expect(inquiry.contactEmailCiphertext).toBe('');
      expect(inquiry.contactEmailHmac).toMatch(/^anonymised:/);
      expect(await prisma.companyMembership.count({ where: { companyId: company.id } })).toBe(0);
      expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).anonymisedAt).not.toBeNull();
      // the money-free business record stays: the Inquiry, its Program, its status
      expect(inquiry.status).toBe('NEW');

      as(member);
      expect((await inquiriesRoute.GET()).status).toBe(404);

      // Idempotent: running again later leaves this company's stamp as it was.
      const stamp = (await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).anonymisedAt;
      await lib.anonymiseExpiredCompanies(prisma, new Date(filedAt.getTime() + 3 * YEAR_MS));
      expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).anonymisedAt).toEqual(stamp);
    });

    it('keeps a company whose people were active recently', async () => {
      const programId = await makeProgram('program-aktif');
      const member = await makeUser('mia@theta.co.id', { name: 'Mia Theta' });
      await joinAs(member, 'Theta');
      await file(member, programId, 'Masih aktif');
      const company = await prisma.company.findUniqueOrThrow({ where: { emailDomain: 'theta.co.id' } });
      await prisma.company.update({ where: { id: company.id }, data: { createdAt: new Date('2020-01-01T00:00:00Z') } });
      const result = await lib.anonymiseExpiredCompanies(prisma, new Date(Date.now() + 24 * 3600 * 1000));
      expect(result.anonymisedCount).toBe(0);
      expect((await prisma.partnershipInquiry.findFirstOrThrow({ where: { companyId: company.id } })).contactName).toBe('Mia Theta');
    });

    it('anonymises a public-form Inquiry (no company) two years after it came in, and leaves a younger one alone', async () => {
      const programId = await makeProgram('program-lama');
      const { sealInquiryContactEmail } = await import('@/lib/contact-fields');
      const old = await prisma.partnershipInquiry.create({
        data: {
          programId,
          companyName: 'Lama',
          contactName: 'Orang Lama',
          needs: 'dulu',
          createdAt: new Date('2015-01-01T00:00:00Z'),
          ...sealInquiryContactEmail('lama@lama.example'),
        },
      });
      const recentAt = new Date();
      recentAt.setUTCFullYear(recentAt.getUTCFullYear() - 1);
      const recent = await prisma.partnershipInquiry.create({
        data: {
          programId,
          companyName: 'Baru',
          contactName: 'Orang Baru',
          needs: 'tahun lalu',
          createdAt: recentAt,
          ...sealInquiryContactEmail('baru@baru.example'),
        },
      });
      await lib.anonymiseExpiredCompanies(prisma, new Date());
      expect((await prisma.partnershipInquiry.findUniqueOrThrow({ where: { id: old.id } })).contactName).toBe('[dianonimkan]');
      expect((await prisma.partnershipInquiry.findUniqueOrThrow({ where: { id: recent.id } })).contactName).toBe('Orang Baru');
    });
  });
});
