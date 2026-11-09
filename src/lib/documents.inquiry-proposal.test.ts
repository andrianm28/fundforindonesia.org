// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  absoluteStoragePath,
  canReadDocument,
  DocumentRefusedError,
  readDocument,
  uploadInquiryProposal,
} from './documents';

/**
 * pks-pemenuhan/17 (PKS Pasal 3.6): the proposal PDF of a Partnership Inquiry
 * is a private Document, the fourth kind. A company on the public form has no
 * account, so it has no uploader; a Tim CSR member does. Either way the file is
 * sealed at rest and only an Admin (and a member's own upload) can open it.
 */

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x31, 0x32]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

type Row = Record<string, unknown>;

function fakePrisma(inquiries: Row[] = [{ id: 'inq-1' }]) {
  const documents: Row[] = [];
  return {
    documents,
    prisma: {
      partnershipInquiry: {
        findUnique: vi.fn(async ({ where }: { where: Row }) => inquiries.find((r) => r.id === where.id) ?? null),
      },
      document: {
        create: vi.fn(async ({ data }: { data: Row }) => {
          const row = { id: `doc-${documents.length + 1}`, uploadedAt: new Date(), checklistItemId: null, ...data };
          documents.push(row);
          return row;
        }),
        findUnique: vi.fn(async ({ where }: { where: Row }) => documents.find((d) => d.id === where.id) ?? null),
      },
    } as never,
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inquiry-proposal-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const file = (bytes: Uint8Array, declaredType: string) => ({ bytes, declaredType, size: bytes.byteLength });

describe('uploadInquiryProposal', () => {
  it('stores a public company proposal as a private Document owned by the Inquiry, with no uploader', async () => {
    const { prisma, documents } = fakePrisma();

    const summary = await uploadInquiryProposal(prisma, {
      inquiryId: 'inq-1',
      uploadedById: null,
      file: file(PDF, 'application/pdf'),
      root,
    });

    expect(summary).toEqual(expect.objectContaining({ contentType: 'application/pdf', label: 'Proposal kolaborasi' }));
    expect(documents[0]).toEqual(
      expect.objectContaining({
        partnershipInquiryId: 'inq-1',
        uploadedById: null,
        campaignId: null,
        partnerOrganisationId: null,
        payoutId: null,
      }),
    );
  });

  it('seals the bytes at rest and gives them back only through readDocument', async () => {
    const { prisma, documents } = fakePrisma();
    await uploadInquiryProposal(prisma, {
      inquiryId: 'inq-1',
      uploadedById: null,
      file: file(PDF, 'application/pdf'),
      root,
    });

    const onDisk = await readFile(absoluteStoragePath(root, documents[0].storagePath as string)!);
    expect(Buffer.from(onDisk).includes(Buffer.from(PDF))).toBe(false);

    const read = await readDocument(prisma, {
      documentId: 'doc-1',
      viewer: { id: 'admin-1', assignments: ['ADMIN'] as never },
      root,
    });
    expect(Array.from(read!.bytes)).toEqual(Array.from(PDF));
  });

  it('accepts a PDF only: an image, or bytes that are not the declared PDF, are refused', async () => {
    const { prisma, documents } = fakePrisma();

    await expect(
      uploadInquiryProposal(prisma, { inquiryId: 'inq-1', uploadedById: null, file: file(PNG, 'image/png'), root }),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      uploadInquiryProposal(prisma, { inquiryId: 'inq-1', uploadedById: null, file: file(PNG, 'application/pdf'), root }),
    ).rejects.toBeInstanceOf(DocumentRefusedError);
    expect(documents).toEqual([]);
  });

  it('refuses an Inquiry that does not exist and writes nothing', async () => {
    const { prisma, documents } = fakePrisma([]);

    await expect(
      uploadInquiryProposal(prisma, {
        inquiryId: 'nope',
        uploadedById: null,
        file: file(PDF, 'application/pdf'),
        root,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(documents).toEqual([]);
  });

  it('is not stored at all when document storage is not configured', async () => {
    const { prisma, documents } = fakePrisma();

    await expect(
      uploadInquiryProposal(prisma, {
        inquiryId: 'inq-1',
        uploadedById: null,
        file: file(PDF, 'application/pdf'),
        root: null,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(documents).toEqual([]);
  });
});

describe('who may open a proposal', () => {
  const proposal = { uploadedById: 'member-1', campaignId: null, partnerOrganisationId: null, partnershipInquiryId: 'inq-1' };
  const { prisma } = fakePrisma();

  it('lets an Admin and the uploading Tim CSR member read it', async () => {
    expect(await canReadDocument(prisma, proposal, { id: 'admin-1', assignments: ['ADMIN'] as never })).toBe(true);
    expect(await canReadDocument(prisma, proposal, { id: 'member-1', assignments: [] as never })).toBe(true);
  });

  it('keeps it from a Verifier, another account, and a public upload from everyone but an Admin', async () => {
    expect(await canReadDocument(prisma, proposal, { id: 'v-1', assignments: ['VERIFIER'] as never })).toBe(false);
    expect(await canReadDocument(prisma, proposal, { id: 'other', assignments: [] as never })).toBe(false);
    const anonymous = { ...proposal, uploadedById: null };
    expect(await canReadDocument(prisma, anonymous, { id: 'member-1', assignments: [] as never })).toBe(false);
    expect(await canReadDocument(prisma, anonymous, { id: 'admin-1', assignments: ['ADMIN'] as never })).toBe(true);
  });
});
