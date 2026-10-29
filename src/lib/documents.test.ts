// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  absoluteStoragePath,
  canReadDocument,
  documentRoot,
  DocumentRefusedError,
  MAX_DOCUMENT_SIZE,
  newStoragePath,
  readDocument,
  sniffDocumentType,
  uploadDocument,
  validateDocumentFile,
} from './documents';

/**
 * Ticket 64: the private document store. The ACL is the point of the ticket,
 * so every role is asked about both kinds of document; the storage half runs
 * against a real temporary directory, because "the bytes are where the row
 * says, and nowhere public" is a property of the filesystem.
 */

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');

type Row = Record<string, unknown>;

/** A Prisma stand-in holding exactly the rows each test seeds. */
function fakePrisma(seed: {
  campaigns?: Row[];
  requests?: Row[];
  organisations?: Row[];
  items?: Row[];
  documents?: Row[];
}) {
  const documents = [...(seed.documents ?? [])];
  const byId = (rows: Row[] | undefined, id: unknown) => (rows ?? []).find((r) => r.id === id) ?? null;
  return {
    documents,
    prisma: {
      campaign: { findUnique: vi.fn(async ({ where }: { where: Row }) => byId(seed.campaigns, where.id)) },
      partnerOrganisation: {
        findUnique: vi.fn(async ({ where }: { where: Row }) => byId(seed.organisations, where.id)),
      },
      verificationChecklistItem: {
        findUnique: vi.fn(async ({ where }: { where: Row }) => byId(seed.items, where.id)),
      },
      verificationRequest: {
        findFirst: vi.fn(async ({ where }: { where: { campaignId: string; OR: Row[] } }) => {
          const match = (seed.requests ?? []).find(
            (r) =>
              r.campaignId === where.campaignId &&
              where.OR.some((clause) => Object.entries(clause).every(([k, v]) => r[k] === v)),
          );
          return match ? { id: match.id } : null;
        }),
      },
      document: {
        findUnique: vi.fn(async ({ where }: { where: Row }) => byId(documents, where.id)),
        create: vi.fn(async ({ data }: { data: Row }) => {
          const row: Row = { id: `doc-${documents.length + 1}`, uploadedAt: new Date('2026-10-29T00:00:00Z'), ...data };
          documents.push(row);
          return {
            id: row.id,
            label: row.label,
            checklistItemId: row.checklistItemId,
            contentType: row.contentType,
            sizeBytes: row.sizeBytes,
            uploadedAt: row.uploadedAt,
          };
        }),
      },
    },
  };
}

const CAMPAIGN = { id: 'c1', creatorId: 'fundraiser', kind: 'DONATION', lifecycleStatus: 'DRAFT' };
const ITEM = { id: 'identitas-fundraiser', label: 'KTP Fundraiser', active: true, requiresDocument: true, kind: null };
const ORG = { id: 'org1', fundraiserId: 'org-account' };

const campaignDoc = { uploadedById: 'fundraiser', campaignId: 'c1', partnerOrganisationId: null };
const orgDoc = { uploadedById: 'verifier-a', campaignId: null, partnerOrganisationId: 'org1' };

const viewer = (id: string, ...assignments: string[]) => ({ id, assignments: assignments as never });

describe('sniffDocumentType', () => {
  it('recognises a PDF and the image types by their bytes', () => {
    expect(sniffDocumentType(PDF)).toBe('application/pdf');
    expect(sniffDocumentType(PNG)).toBe('image/png');
    expect(sniffDocumentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('recognises nothing else: HTML, SVG, empty', () => {
    expect(sniffDocumentType(HTML)).toBeNull();
    expect(sniffDocumentType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffDocumentType(new Uint8Array())).toBeNull();
  });
});

describe('validateDocumentFile', () => {
  it('accepts a PDF declared as one', () => {
    expect(validateDocumentFile({ bytes: PDF, declaredType: 'application/pdf', size: PDF.length })).toBe('application/pdf');
  });

  it('refuses HTML declared as a PDF (415): the declared type is only a claim', () => {
    expect(() => validateDocumentFile({ bytes: HTML, declaredType: 'application/pdf', size: HTML.length })).toThrow(
      expect.objectContaining({ status: 415 }),
    );
  });

  it('refuses a PNG declared as a PDF, and a type not on the list', () => {
    expect(() => validateDocumentFile({ bytes: PNG, declaredType: 'application/pdf', size: PNG.length })).toThrow(
      expect.objectContaining({ status: 415 }),
    );
    expect(() => validateDocumentFile({ bytes: HTML, declaredType: 'text/html', size: HTML.length })).toThrow(
      expect.objectContaining({ status: 415 }),
    );
  });

  it('refuses a file over 10MB (413) and an empty one (400)', () => {
    expect(() =>
      validateDocumentFile({ bytes: PDF, declaredType: 'application/pdf', size: MAX_DOCUMENT_SIZE + 1 }),
    ).toThrow(expect.objectContaining({ status: 413 }));
    expect(() => validateDocumentFile({ bytes: new Uint8Array(), declaredType: 'application/pdf', size: 0 })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('storage paths', () => {
  it('are random, sharded, relative and extensionless', () => {
    const a = newStoragePath();
    expect(a).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}$/);
    expect(a.slice(0, 2)).toBe(a.slice(3, 5));
    expect(newStoragePath()).not.toBe(a);
  });

  it('never resolve outside the root', () => {
    expect(absoluteStoragePath('/srv/docs', 'ab/' + 'ab'.repeat(32))).toBe('/srv/docs/ab/' + 'ab'.repeat(32));
    expect(absoluteStoragePath('/srv/docs', '../etc/passwd')).toBeNull();
    expect(absoluteStoragePath('/srv/docs', '/etc/passwd')).toBeNull();
    expect(absoluteStoragePath('/srv/docs', 'ab/../../x')).toBeNull();
  });

  it('live under PRIVATE_DOCUMENT_DIR; outside production a folder that is not public/; production without it has none', () => {
    expect(documentRoot({ PRIVATE_DOCUMENT_DIR: '/data/docs', NODE_ENV: 'production' } as never)).toBe('/data/docs');
    expect(documentRoot({ NODE_ENV: 'production' } as never)).toBeNull();
    const dev = documentRoot({ NODE_ENV: 'development' } as never)!;
    expect(dev).toBe(join(process.cwd(), 'storage', 'private-documents'));
    expect(dev).not.toContain(`${join('', 'public')}`);
  });
});

describe('canReadDocument: who may open a Campaign document', () => {
  const db = (requests: Row[] = []) =>
    fakePrisma({ campaigns: [CAMPAIGN], requests }).prisma as never;

  it('lets the uploader and the Campaign Fundraiser open it', async () => {
    expect(await canReadDocument(db(), campaignDoc, viewer('fundraiser'))).toBe(true);
    expect(await canReadDocument(db(), { ...campaignDoc, uploadedById: 'someone' }, viewer('fundraiser'))).toBe(true);
  });

  it('lets an Admin open it, request or no request', async () => {
    expect(await canReadDocument(db(), campaignDoc, viewer('admin', 'ADMIN'))).toBe(true);
  });

  it('lets a Verifier open it while the Campaign has a Verification Request open', async () => {
    const prisma = db([{ id: 'vr1', campaignId: 'c1', outcome: 'PENDING', decidedById: null }]);
    expect(await canReadDocument(prisma, campaignDoc, viewer('verifier-a', 'VERIFIER'))).toBe(true);
  });

  it('lets the Verifier who decided one of its requests open it afterwards, and no other Verifier', async () => {
    const prisma = db([{ id: 'vr1', campaignId: 'c1', outcome: 'REJECTED', decidedById: 'verifier-a' }]);
    expect(await canReadDocument(prisma, campaignDoc, viewer('verifier-a', 'VERIFIER'))).toBe(true);
    expect(await canReadDocument(prisma, campaignDoc, viewer('verifier-b', 'VERIFIER'))).toBe(false);
  });

  it('refuses a Verifier when nothing about the Campaign is with a Verifier', async () => {
    expect(await canReadDocument(db(), campaignDoc, viewer('verifier-a', 'VERIFIER'))).toBe(false);
  });

  it('refuses any other signed-in user, even while a request is open', async () => {
    const prisma = db([{ id: 'vr1', campaignId: 'c1', outcome: 'PENDING', decidedById: null }]);
    expect(await canReadDocument(prisma, campaignDoc, viewer('donor'))).toBe(false);
  });
});

describe("canReadDocument: who may open a Partner Organisation's document", () => {
  const db = () => fakePrisma({ organisations: [ORG] }).prisma as never;

  it('lets any Verifier, an Admin and the organisation account open it', async () => {
    expect(await canReadDocument(db(), orgDoc, viewer('verifier-b', 'VERIFIER'))).toBe(true);
    expect(await canReadDocument(db(), orgDoc, viewer('admin', 'ADMIN'))).toBe(true);
    expect(await canReadDocument(db(), orgDoc, viewer('org-account'))).toBe(true);
  });

  it('refuses everyone else, a Fundraiser of a Campaign it collects included', async () => {
    expect(await canReadDocument(db(), orgDoc, viewer('fundraiser'))).toBe(false);
  });
});

describe('uploadDocument and readDocument against a real directory', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ffi-docs-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const pdf = { bytes: PDF, declaredType: 'application/pdf', size: PDF.length };

  it("stores a Fundraiser's document for a checklist item, under a random name, readable back only through the ACL", async () => {
    const db = fakePrisma({ campaigns: [CAMPAIGN], items: [ITEM] });

    const summary = await uploadDocument(db.prisma as never, {
      actor: viewer('fundraiser'),
      file: pdf,
      target: { campaignId: 'c1', checklistItemId: 'identitas-fundraiser' },
      root,
    });

    expect(summary).toMatchObject({ label: 'KTP Fundraiser', checklistItemId: 'identitas-fundraiser', contentType: 'application/pdf', sizeBytes: PDF.length });
    expect(summary).not.toHaveProperty('storagePath');
    const row = db.documents[0];
    expect(row.storagePath).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}$/);
    expect(row).toMatchObject({ uploadedById: 'fundraiser', campaignId: 'c1', partnerOrganisationId: null });
    const written = join(root, row.storagePath as string);
    expect(new Uint8Array(await readFile(written))).toEqual(PDF);
    expect((await stat(written)).mode & 0o077).toBe(0);

    const mine = await readDocument(db.prisma as never, { documentId: row.id as string, viewer: viewer('fundraiser'), root });
    expect(mine?.contentType).toBe('application/pdf');
    expect(new Uint8Array(mine!.bytes)).toEqual(PDF);
    expect(await readDocument(db.prisma as never, { documentId: row.id as string, viewer: viewer('donor'), root })).toBeNull();
    expect(await readDocument(db.prisma as never, { documentId: 'nope', viewer: viewer('fundraiser'), root })).toBeNull();
  });

  it("answers a stranger's upload to someone else's Campaign as a missing Campaign, writing nothing", async () => {
    const db = fakePrisma({ campaigns: [CAMPAIGN], items: [ITEM] });

    await expect(
      uploadDocument(db.prisma as never, {
        actor: viewer('stranger', 'VERIFIER'),
        file: pdf,
        target: { campaignId: 'c1', checklistItemId: 'identitas-fundraiser' },
        root,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.documents).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });

  it('refuses an item that needs no document, an inactive one, and one of another Kind', async () => {
    for (const item of [
      { ...ITEM, requiresDocument: false },
      { ...ITEM, active: false },
      { ...ITEM, kind: 'WAKAF' },
    ]) {
      const db = fakePrisma({ campaigns: [CAMPAIGN], items: [item] });
      await expect(
        uploadDocument(db.prisma as never, {
          actor: viewer('fundraiser'),
          file: pdf,
          target: { campaignId: 'c1', checklistItemId: item.id },
          root,
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it('refuses a closed Campaign (409)', async () => {
    const db = fakePrisma({ campaigns: [{ ...CAMPAIGN, lifecycleStatus: 'COMPLETED' }], items: [ITEM] });
    await expect(
      uploadDocument(db.prisma as never, {
        actor: viewer('fundraiser'),
        file: pdf,
        target: { campaignId: 'c1', checklistItemId: 'identitas-fundraiser' },
        root,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("lets a Verifier record an organisation's document with a title, and refuses anyone else as a missing organisation", async () => {
    const db = fakePrisma({ organisations: [ORG] });

    const summary = await uploadDocument(db.prisma as never, {
      actor: viewer('verifier-a', 'VERIFIER'),
      file: pdf,
      target: { partnerOrganisationId: 'org1', label: '  Akta pendirian  ' },
      root,
    });
    expect(summary).toMatchObject({ label: 'Akta pendirian', checklistItemId: null });

    await expect(
      uploadDocument(db.prisma as never, {
        actor: viewer('org-account'),
        file: pdf,
        target: { partnerOrganisationId: 'org1', label: 'Akta' },
        root,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      uploadDocument(db.prisma as never, {
        actor: viewer('verifier-a', 'VERIFIER'),
        file: pdf,
        target: { partnerOrganisationId: 'org1', label: '   ' },
        root,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('removes the written file when the row cannot be recorded', async () => {
    const db = fakePrisma({ campaigns: [CAMPAIGN], items: [ITEM] });
    db.prisma.document.create.mockRejectedValueOnce(new Error('db down'));

    await expect(
      uploadDocument(db.prisma as never, {
        actor: viewer('fundraiser'),
        file: pdf,
        target: { campaignId: 'c1', checklistItemId: 'identitas-fundraiser' },
        root,
      }),
    ).rejects.toThrow('db down');
    const shards = await readdir(root);
    for (const shard of shards) expect(await readdir(join(root, shard))).toEqual([]);
  });

  it('refuses every upload with 503 when production has no document volume', async () => {
    const db = fakePrisma({ campaigns: [CAMPAIGN], items: [ITEM] });
    await expect(
      uploadDocument(db.prisma as never, {
        actor: viewer('fundraiser'),
        file: pdf,
        target: { campaignId: 'c1', checklistItemId: 'identitas-fundraiser' },
        root: null,
      }),
    ).rejects.toEqual(new DocumentRefusedError('Penyimpanan dokumen belum dikonfigurasi.', 503));
  });
});
