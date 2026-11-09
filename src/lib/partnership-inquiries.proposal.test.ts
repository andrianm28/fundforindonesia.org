// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createPartnershipInquiry,
  InvalidPartnershipInquiryInputError,
  partnershipInquiryErrorToHttp,
  PARTNERSHIP_TEAM_EMAIL_ENV,
  type PartnershipInquiryCreateInput,
} from './partnership-inquiries';
import { MockMailer } from './mail/mock-mailer';

/**
 * pks-pemenuhan/17: a proposal PDF travels with the Inquiry and becomes a
 * private Document owned by it. The file is checked BEFORE the Inquiry is
 * written (a bad PDF must not leave an Inquiry behind, or use up the public
 * form's rate limit), and a store that fails AFTER the Inquiry is written does
 * not undo it: the company asked, and a lost attachment is reported to them,
 * never a duplicate submission.
 */

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x31]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

const VALID: PartnershipInquiryCreateInput = {
  programId: 'program-1',
  companyName: 'PT Sinar Abadi',
  contactName: 'Rina Wijaya',
  contactEmail: 'rina@sinarabadi.test',
  needs: 'Kami ingin mendanai mobilitas tim kesehatan.',
};

function makeDb() {
  const inquiries: Record<string, unknown>[] = [];
  const documents: Record<string, unknown>[] = [];
  const db = {
    program: { findUnique: async () => ({ id: 'program-1', title: 'Klinik Keliling Pesisir', sector: 'HEALTH' }) },
    partnershipInquiry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `inquiry-${inquiries.length + 1}`, ...data };
        inquiries.push(row);
        return { ...row };
      },
      findUnique: async ({ where }: { where: { id: string } }) => inquiries.find((r) => r.id === where.id) ?? null,
    },
    document: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `doc-${documents.length + 1}`, uploadedAt: new Date(), ...data };
        documents.push(row);
        return row;
      },
    },
  };
  return { db, inquiries, documents };
}

const proposal = (bytes: Uint8Array, declaredType: string) => ({ bytes, declaredType, size: bytes.byteLength });

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inquiry-proposal-create-'));
  vi.stubEnv('PRIVATE_DOCUMENT_DIR', root);
  vi.stubEnv(PARTNERSHIP_TEAM_EMAIL_ENV, 'kemitraan@contoh.test');
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('createPartnershipInquiry with a proposal', () => {
  it('stores the PDF as a private Document of the new Inquiry, with no uploader for the public form', async () => {
    const { db, documents } = makeDb();

    const inquiry = await createPartnershipInquiry(db as never, VALID, new MockMailer(), undefined, {
      proposal: proposal(PDF, 'application/pdf'),
    });

    expect(documents).toEqual([
      expect.objectContaining({ partnershipInquiryId: inquiry.id, uploadedById: null, contentType: 'application/pdf' }),
    ]);
    expect(inquiry).toEqual(expect.objectContaining({ proposalStored: true }));
  });

  it("names a Tim CSR member as the uploader when the member's own path passes their id", async () => {
    const { db, documents } = makeDb();

    await createPartnershipInquiry(db as never, VALID, new MockMailer(), undefined, {
      proposal: proposal(PDF, 'application/pdf'),
      uploadedById: 'member-1',
    });

    expect(documents[0].uploadedById).toBe('member-1');
  });

  it('writes no Inquiry at all for a proposal that is not a PDF, and does not run the pre-write hook', async () => {
    const { db, inquiries, documents } = makeDb();
    const beforeWrite = vi.fn(async () => undefined);

    await expect(
      createPartnershipInquiry(db as never, VALID, new MockMailer(), beforeWrite, { proposal: proposal(PNG, 'image/png') }),
    ).rejects.toBeInstanceOf(InvalidPartnershipInquiryInputError);
    await expect(
      createPartnershipInquiry(db as never, VALID, new MockMailer(), beforeWrite, { proposal: proposal(PNG, 'application/pdf') }),
    ).rejects.toBeInstanceOf(InvalidPartnershipInquiryInputError);

    expect(inquiries).toEqual([]);
    expect(documents).toEqual([]);
    expect(beforeWrite).not.toHaveBeenCalled();
  });

  it('refuses before writing when document storage is not configured, with a 503', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PRIVATE_DOCUMENT_DIR', '');
    const { db, inquiries } = makeDb();

    const error = await createPartnershipInquiry(db as never, VALID, new MockMailer(), undefined, {
      proposal: proposal(PDF, 'application/pdf'),
    }).catch((e) => e);

    expect(partnershipInquiryErrorToHttp(error)).toEqual({ status: 503, error: expect.stringContaining('belum dikonfigurasi') });
    expect(inquiries).toEqual([]);
  });

  it('keeps the Inquiry when the Document row fails afterwards, and says the proposal was not stored', async () => {
    const { db, inquiries } = makeDb();
    db.document.create = async () => {
      throw new Error('disk full');
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const inquiry = await createPartnershipInquiry(db as never, VALID, new MockMailer(), undefined, {
      proposal: proposal(PDF, 'application/pdf'),
    });

    expect(inquiries).toHaveLength(1);
    expect(inquiry).toEqual(expect.objectContaining({ proposalStored: false }));
    expect(logged).toHaveBeenCalled();
  });

  it('is unchanged when no proposal is attached', async () => {
    const { db, documents } = makeDb();

    const inquiry = await createPartnershipInquiry(db as never, VALID, new MockMailer());

    expect(documents).toEqual([]);
    expect(inquiry).toEqual(expect.objectContaining({ proposalStored: false }));
  });
});
