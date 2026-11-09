// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { sealUserEmail } from '@/lib/contact-fields';

/**
 * pks-pemenuhan/17 against real Postgres: the CSR pipeline as the routes run it.
 * The in-memory doubles prove the rules; this proves the queries are ones the
 * database accepts (the pipeline list and detail read relations through nested
 * selects), that a proposal PDF becomes a private Document of the Inquiry with
 * no uploader, that a PIC must hold ADMIN, that the history keeps the actor,
 * the note and the PIC change, that the address and NPWP are ciphertext on disk
 * and are cleared by the company retention job.
 *
 * Skipped, visibly, without TEST_DATABASE_URL (docs/agents/verification.md).
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x31]);
// Obviously fake, built at runtime: a run of zeros is nobody's NPWP.
const FAKE_NPWP = '0'.repeat(15);

describe.skipIf(!DATABASE_URL)('CSR pipeline -- against real Postgres (pks-pemenuhan/17)', () => {
  if (!DATABASE_URL) {
    console.warn('[csr pipeline] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `csr_pipeline_real_${process.pid}`;
  let prisma: PrismaClient;
  let documentRoot: string;
  let session: { user: { id: string; assignments: string[] } } | null = null;
  let publicRoute: typeof import('@/app/api/partnership-inquiries/route');
  let adminList: typeof import('@/app/api/admin/partnership-inquiries/route');
  let adminOne: typeof import('@/app/api/admin/partnership-inquiries/[id]/route');
  let documents: typeof import('@/lib/documents');
  let tim: typeof import('@/lib/tim-csr');

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    documentRoot = await mkdtemp(join(tmpdir(), 'csr-pipeline-real-'));
    vi.stubEnv('PRIVATE_DOCUMENT_DIR', documentRoot);

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
      return { ...original, sendReportingFailure: async () => undefined };
    });
    publicRoute = await import('@/app/api/partnership-inquiries/route');
    adminList = await import('@/app/api/admin/partnership-inquiries/route');
    adminOne = await import('@/app/api/admin/partnership-inquiries/[id]/route');
    documents = await import('@/lib/documents');
    tim = await import('@/lib/tim-csr');
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    vi.unstubAllEnvs();
    await prisma?.$disconnect();
    await rm(documentRoot, { recursive: true, force: true });
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  let counter = 0;
  async function makeUser(email: string, name: string, isAdmin: boolean): Promise<string> {
    const id = `u-${process.pid}-${counter++}`;
    await prisma.user.create({
      data: {
        id,
        name,
        ...sealUserEmail(email),
        emailVerifiedAt: new Date('2026-10-01T00:00:00Z'),
        ...(isAdmin ? { assignments: { create: { assignment: 'ADMIN' } } } : {}),
      },
    });
    return id;
  }

  async function makeProgram(slug: string): Promise<string> {
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
      },
    });
    return program.id;
  }

  function asAdmin(id: string) {
    session = { user: { id, assignments: ['ADMIN'] } };
  }

  async function submitPublic(programId: string, withProposal: boolean): Promise<string> {
    const form = new FormData();
    form.set('programId', programId);
    form.set('companyName', 'PT Contoh Nyata');
    form.set('contactName', 'Rina Wijaya');
    form.set('contactEmail', 'rina@contohnyata.test');
    form.set('needs', 'Kami ingin mendanai klinik keliling.');
    form.set('budgetRange', 'FROM_250M_TO_1B');
    form.set('periodStart', '2027-01');
    form.set('periodEnd', '2027-06');
    form.set('companyAddress', 'Jl. Contoh Nomor 1, Kota Contoh');
    form.set('companyNpwp', FAKE_NPWP);
    if (withProposal) form.set('proposal', new File([PDF as BlobPart], 'proposal.pdf', { type: 'application/pdf' }));
    const res = await publicRoute.POST(
      new NextRequest('http://localhost/api/partnership-inquiries', {
        method: 'POST',
        body: form,
        headers: { 'x-forwarded-for': '203.0.113.50' },
      }),
    );
    expect(res.status).toBe(201);
    return (await res.json()).inquiry.id as string;
  }

  function patch(id: string, body: unknown) {
    return adminOne.PATCH(
      new NextRequest(`http://localhost/api/admin/partnership-inquiries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  it('stores the public form fields and the proposal PDF as a private Document with no uploader', async () => {
    const programId = await makeProgram('program-proposal');
    const inquiryId = await submitPublic(programId, true);

    const row = await prisma.partnershipInquiry.findUniqueOrThrow({ where: { id: inquiryId } });
    expect(row).toMatchObject({ status: 'NEW', budgetRange: 'FROM_250M_TO_1B', periodStart: '2027-01', periodEnd: '2027-06' });
    // Ciphertext on disk, never the typed value.
    expect(row.companyAddressCiphertext).not.toContain('Jl. Contoh');
    expect(row.companyNpwpCiphertext).not.toContain(FAKE_NPWP);

    const docs = await prisma.document.findMany({ where: { partnershipInquiryId: inquiryId } });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ uploadedById: null, campaignId: null, partnerOrganisationId: null, payoutId: null });

    // Only an Admin can open it: an unrelated account cannot, and a Verifier cannot.
    const adminId = await makeUser('admin@kemitraan.test', 'Admin Kemitraan', true);
    const read = await documents.readDocument(prisma, {
      documentId: docs[0].id,
      viewer: { id: adminId, assignments: ['ADMIN'] as never },
    });
    expect(Array.from(read!.bytes)).toEqual(Array.from(PDF));
    const stranger = await makeUser('orang@lain.test', 'Orang Lain', false);
    expect(
      await documents.readDocument(prisma, { documentId: docs[0].id, viewer: { id: stranger, assignments: [] as never } }),
    ).toBeNull();
    expect(
      await documents.readDocument(prisma, { documentId: docs[0].id, viewer: { id: stranger, assignments: ['VERIFIER'] as never } }),
    ).toBeNull();
  });

  it('works the pipeline: PIC (Admin only), stage, note, and the history the database keeps', async () => {
    const programId = await makeProgram('program-pipeline');
    const inquiryId = await submitPublic(programId, false);
    const admin1 = await makeUser('satu@kemitraan.test', 'Dewi Admin', true);
    const admin2 = await makeUser('dua@kemitraan.test', 'Bagas Admin', true);
    const plain = await makeUser('biasa@pengguna.test', 'Siti Biasa', false);
    asAdmin(admin1);

    // A PIC who is not an Admin is refused, and nothing is written.
    expect((await patch(inquiryId, { picId: plain })).status).toBe(400);
    expect(await prisma.partnershipInquiryStatusChange.count({ where: { inquiryId } })).toBe(0);

    // Stage and PIC and note together: one history entry.
    const ok = await patch(inquiryId, { status: 'NEGOTIATION', picId: admin2, note: 'Bagas yang pegang.' });
    expect(ok.status).toBe(200);
    const history = await prisma.partnershipInquiryStatusChange.findMany({ where: { inquiryId } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: 'NEW',
      toStatus: 'NEGOTIATION',
      actedById: admin1,
      note: 'Bagas yang pegang.',
      picChanged: true,
      picFromId: null,
      picToId: admin2,
    });

    // The pipeline list reads PIC, proposal flag and last stage change through nested selects.
    const list = (await (await adminList.GET(new NextRequest('http://localhost/api/admin/partnership-inquiries'), {})).json()) as {
      inquiries: { id: string; status: string; pic: { name: string } | null; lastStatusChange: { actedByName: string } | null }[];
      pics: { id: string }[];
    };
    const mine = list.inquiries.find((i) => i.id === inquiryId)!;
    expect(mine).toMatchObject({ status: 'NEGOTIATION', pic: { name: 'Bagas Admin' }, lastStatusChange: { actedByName: 'Dewi Admin' } });
    expect(list.pics.map((p) => p.id)).toEqual(expect.arrayContaining([admin1, admin2]));
    expect(list.pics.map((p) => p.id)).not.toContain(plain);

    // The detail reads the sealed fields back, with the history and its notes.
    const detail = (
      await (
        await adminOne.GET(new NextRequest(`http://localhost/api/admin/partnership-inquiries/${inquiryId}`), {
          params: Promise.resolve({ id: inquiryId }),
        })
      ).json()
    ).inquiry;
    expect(detail).toMatchObject({
      contactEmail: 'rina@contohnyata.test',
      companyAddress: 'Jl. Contoh Nomor 1, Kota Contoh',
      companyNpwp: FAKE_NPWP,
      pic: { name: 'Bagas Admin' },
    });
    expect(detail.history).toEqual([expect.objectContaining({ actedByName: 'Dewi Admin', note: 'Bagas yang pegang.', picToName: 'Bagas Admin' })]);

    // Free to move back, and out of a closed stage only with a reason.
    expect((await patch(inquiryId, { status: 'CONTACTED' })).status).toBe(200);
    expect((await patch(inquiryId, { status: 'DROPPED', note: 'Anggaran dibatalkan.' })).status).toBe(200);
    expect((await patch(inquiryId, { status: 'NEW' })).status).toBe(400);
    expect((await patch(inquiryId, { status: 'NEW', note: 'Dibuka lagi atas permintaan perusahaan.' })).status).toBe(200);
    expect(await prisma.partnershipInquiryStatusChange.count({ where: { inquiryId } })).toBe(4);
  });

  it('answers a literal 404 on the admin routes to a signed-in person without ADMIN', async () => {
    const programId = await makeProgram('program-404');
    const inquiryId = await submitPublic(programId, false);
    const plain = await makeUser('bukan@admin.test', 'Bukan Admin', false);
    session = { user: { id: plain, assignments: [] } };

    const listed = await adminList.GET(new NextRequest('http://localhost/api/admin/partnership-inquiries'), {});
    expect(listed.status).toBe(404);
    expect(await listed.json()).toEqual({ error: 'Not Found' });
    const changed = await patch(inquiryId, { status: 'CONTACTED' });
    expect(changed.status).toBe(404);
    expect((await prisma.partnershipInquiry.findUniqueOrThrow({ where: { id: inquiryId } })).status).toBe('NEW');
  });

  it('clears the address and NPWP when the retention job anonymises a company', async () => {
    const programId = await makeProgram('program-retensi');
    const member = await makeUser('mia@retensi-co.co.id', 'Mia Retensi', false);
    session = { user: { id: member, assignments: [] } };
    const membership = await import('@/app/api/csr/membership/route');
    const joined = await membership.POST(
      new NextRequest('http://localhost/api/csr/membership', {
        method: 'POST',
        body: JSON.stringify({ companyName: 'Retensi Co' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(joined.status).toBe(201);
    const csr = await import('@/app/api/csr/inquiries/route');
    const form = new FormData();
    form.set('programId', programId);
    form.set('needs', 'Kolaborasi pendidikan.');
    form.set('companyAddress', 'Jl. Retensi Nomor 9');
    form.set('companyNpwp', FAKE_NPWP);
    form.set('proposal', new File([PDF as BlobPart], 'proposal.pdf', { type: 'application/pdf' }));
    const filed = await csr.POST(new NextRequest('http://localhost/api/csr/inquiries', { method: 'POST', body: form }));
    expect(filed.status).toBe(201);

    const company = await prisma.company.findUniqueOrThrow({ where: { emailDomain: 'retensi-co.co.id' } });
    const inquiry = await prisma.partnershipInquiry.findFirstOrThrow({ where: { companyId: company.id } });
    // The member's own proposal names them as the uploader.
    expect((await prisma.document.findFirstOrThrow({ where: { partnershipInquiryId: inquiry.id } })).uploadedById).toBe(member);
    expect(inquiry.companyAddressCiphertext).not.toBeNull();

    const old = new Date('2020-01-01T00:00:00Z');
    await prisma.partnershipInquiry.updateMany({ where: { companyId: company.id }, data: { createdAt: old } });
    await prisma.company.update({ where: { id: company.id }, data: { createdAt: old } });
    await prisma.companyMembership.updateMany({ where: { companyId: company.id }, data: { createdAt: old } });
    expect((await tim.anonymiseExpiredCompanies(prisma, new Date('2026-11-09T00:00:00Z'))).anonymisedCount).toBeGreaterThanOrEqual(1);

    const after = await prisma.partnershipInquiry.findUniqueOrThrow({ where: { id: inquiry.id } });
    expect(after).toMatchObject({
      companyAddressCiphertext: null,
      companyAddressKeyId: null,
      companyNpwpCiphertext: null,
      companyNpwpKeyId: null,
    });
    // The pipeline still reads an anonymised Inquiry: the contact is simply absent.
    asAdmin(await makeUser('admin@retensi.test', 'Admin Retensi', true));
    const detail = (
      await (
        await adminOne.GET(new NextRequest(`http://localhost/api/admin/partnership-inquiries/${inquiry.id}`), {
          params: Promise.resolve({ id: inquiry.id }),
        })
      ).json()
    ).inquiry;
    expect(detail).toMatchObject({ contactEmail: null, contactPhone: null, companyAddress: null, companyNpwp: null });
  });

  it('anonymises a public-form Inquiry after two years and erases its proposal file, keeping the Document row', async () => {
    const programId = await makeProgram('program-public-retention');
    const inquiryId = await submitPublic(programId, true);
    const doc = await prisma.document.findFirstOrThrow({ where: { partnershipInquiryId: inquiryId } });
    const onDisk = () => readdirSync(join(documentRoot, doc.storagePath.slice(0, 2))).includes(doc.storagePath.slice(3));
    expect(onDisk()).toBe(true);

    // Not yet: a recent public Inquiry is kept whole.
    await tim.anonymiseExpiredCompanies(prisma, new Date());
    expect((await prisma.partnershipInquiry.findUniqueOrThrow({ where: { id: inquiryId } })).contactAnonymisedAt).toBeNull();
    expect(onDisk()).toBe(true);

    await prisma.partnershipInquiry.update({ where: { id: inquiryId }, data: { createdAt: new Date('2020-01-01T00:00:00Z') } });
    const result = await tim.anonymiseExpiredCompanies(prisma, new Date('2026-11-09T00:00:00Z'));
    expect(result.anonymisedInquiryCount).toBeGreaterThanOrEqual(1);

    const after = await prisma.partnershipInquiry.findUniqueOrThrow({ where: { id: inquiryId } });
    expect(after.contactAnonymisedAt).not.toBeNull();
    expect(after).toMatchObject({
      contactName: '[dianonimkan]',
      contactEmailCiphertext: '',
      companyAddressCiphertext: null,
      companyNpwpCiphertext: null,
    });
    // The bytes are gone; the Document row and its status history stay.
    expect(onDisk()).toBe(false);
    expect(await prisma.document.count({ where: { id: doc.id } })).toBe(1);
    const adminId = await makeUser('admin@retensi-publik.test', 'Admin Retensi Publik', true);
    expect(
      await documents.readDocument(prisma, { documentId: doc.id, viewer: { id: adminId, assignments: ['ADMIN'] as never } }),
    ).toBeNull();

    // A second run finds nothing left to do.
    expect((await tim.anonymiseExpiredCompanies(prisma, new Date('2026-11-09T00:00:00Z'))).anonymisedInquiryCount).toBe(0);
  });
});
