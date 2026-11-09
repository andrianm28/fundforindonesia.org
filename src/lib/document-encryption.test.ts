// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readDocument, uploadDocument } from './documents';
import { encryptStoredDocuments } from './document-encryption';

/**
 * Contract 10(4), ticket 14: private document bytes are sealed at rest. The
 * seam is the same store the routes use (uploadDocument / readDocument) plus
 * the migration for files written before the change; the filesystem is real.
 */

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x41, 0x42, 0x43]);
const ENC_A = Buffer.alloc(32, 1).toString('base64');
const HMAC_A = Buffer.alloc(32, 2).toString('base64');
const ENC_B = Buffer.alloc(32, 3).toString('base64');

function useKeys(extra: Record<string, string> = {}) {
  vi.stubEnv('FIELD_ENCRYPTION_KEY', ENC_A);
  vi.stubEnv('FIELD_ENCRYPTION_KEY_ID', 'enc-1');
  vi.stubEnv('FIELD_HMAC_KEY', HMAC_A);
  vi.stubEnv('FIELD_HMAC_KEY_ID', 'hmac-1');
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
}

function noKeys() {
  vi.unstubAllEnvs();
  for (const k of ['FIELD_ENCRYPTION_KEY', 'FIELD_ENCRYPTION_KEY_ID', 'FIELD_HMAC_KEY', 'FIELD_HMAC_KEY_ID']) {
    vi.stubEnv(k, '');
  }
}

function fakePrisma() {
  const documents: Record<string, unknown>[] = [];
  return {
    documents,
    prisma: {
      campaign: {
        findUnique: vi.fn(async () => ({ id: 'c1', creatorId: 'fr', kind: 'SOSIAL', lifecycleStatus: 'ACTIVE' })),
      },
      verificationChecklistItem: {
        findUnique: vi.fn(async () => ({ id: 'i1', label: 'KTP', active: true, requiresDocument: true, kind: null })),
      },
      document: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `d${documents.length + 1}`, uploadedAt: new Date(), ...data };
          documents.push(row);
          return row;
        }),
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) => documents.find((d) => d.id === where.id) ?? null,
        ),
      },
    },
  };
}

const viewer = { id: 'fr', assignments: undefined };
const file = { bytes: PDF, declaredType: 'application/pdf', size: PDF.length };
const target = { campaignId: 'c1', checklistItemId: 'i1' };

describe('document bytes at rest', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ffi-docenc-'));
    useKeys();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  async function upload(db = fakePrisma()) {
    await uploadDocument(db.prisma as never, { actor: viewer, file, target, root });
    const row = db.documents[db.documents.length - 1];
    return { db, row, path: join(root, row.storagePath as string) };
  }
  const read = (db: ReturnType<typeof fakePrisma>, id: string) =>
    readDocument(db.prisma as never, { documentId: id, viewer, root });

  it('writes ciphertext, not the plaintext, and reads it back unchanged', async () => {
    const { db, row, path } = await upload();
    const onDisk = await readFile(path);
    expect(onDisk.subarray(0, 8).toString('latin1')).toBe('FFIDOC1\0');
    expect(onDisk.includes(Buffer.from('%PDF-'))).toBe(false);
    expect(onDisk.includes(Buffer.from('ABC'))).toBe(false);
    expect((await stat(path)).mode & 0o077).toBe(0);
    const got = await read(db, row.id as string);
    expect(new Uint8Array(got!.bytes)).toEqual(PDF);
    expect(row.sizeBytes).toBe(PDF.length);
  });

  it('still refuses content that is not what it claims, before anything is written', async () => {
    const db = fakePrisma();
    const html = new TextEncoder().encode('<html></html>');
    await expect(
      uploadDocument(db.prisma as never, {
        actor: viewer,
        file: { bytes: html, declaredType: 'application/pdf', size: html.length },
        target,
        root,
      }),
    ).rejects.toMatchObject({ status: 415 });
    expect(await readdir(root)).toEqual([]);
  });

  it('refuses to store (503) rather than write plaintext when no key is configured', async () => {
    noKeys();
    const db = fakePrisma();
    await expect(uploadDocument(db.prisma as never, { actor: viewer, file, target, root })).rejects.toMatchObject({
      status: 503,
    });
    expect(await readdir(root)).toEqual([]);
    expect(db.documents).toEqual([]);
  });

  it('serves a file written before encryption, without the header, unchanged', async () => {
    const { db, row, path } = await upload();
    await writeFile(path, PDF);
    const got = await read(db, row.id as string);
    expect(new Uint8Array(got!.bytes)).toEqual(PDF);
  });

  it('fails closed on a flipped byte, a truncated file and a swapped file, never serving bytes', async () => {
    const { db, row, path } = await upload();
    const good = await readFile(path);

    const flipped = Buffer.from(good);
    flipped[flipped.length - 20] ^= 0xff;
    await writeFile(path, flipped);
    await expect(read(db, row.id as string)).rejects.toThrow();

    await writeFile(path, good.subarray(0, good.length - 5));
    await expect(read(db, row.id as string)).rejects.toThrow();

    await writeFile(path, good.subarray(0, 12));
    await expect(read(db, row.id as string)).rejects.toThrow();

    // A valid sealed file of another document, copied over this one.
    const second = await upload(db);
    expect(second.path).not.toBe(path);
    await writeFile(path, await readFile(second.path));
    await expect(read(db, row.id as string)).rejects.toThrow();
  });

  it('reads a file sealed under a retired key and fails when that key is gone', async () => {
    const { db, row } = await upload();
    vi.unstubAllEnvs();
    useKeys({
      FIELD_ENCRYPTION_KEY: ENC_B,
      FIELD_ENCRYPTION_KEY_ID: 'enc-2',
      FIELD_ENCRYPTION_PREVIOUS_KEYS: `enc-1:${ENC_A}`,
    });
    expect(new Uint8Array((await read(db, row.id as string))!.bytes)).toEqual(PDF);
    vi.unstubAllEnvs();
    useKeys({ FIELD_ENCRYPTION_KEY: ENC_B, FIELD_ENCRYPTION_KEY_ID: 'enc-2' });
    await expect(read(db, row.id as string)).rejects.toThrow();
  });

  it('serves a legacy plaintext file without any key configured', async () => {
    const { db, row, path } = await upload();
    await writeFile(path, PDF);
    noKeys();
    const got = await read(db, row.id as string);
    expect(new Uint8Array(got!.bytes)).toEqual(PDF);
  });

  it('refuses a legacy plaintext file whose bytes are not the type on record, never serving it', async () => {
    const { db, row, path } = await upload();
    await writeFile(path, Buffer.from('<html><script>alert(1)</script></html>'));
    await expect(read(db, row.id as string)).rejects.toThrow(/failed verification|not a/i);
  });

  it('still answers null for a missing file', async () => {
    const { db, row, path } = await upload();
    await rm(path);
    expect(await read(db, row.id as string)).toBeNull();
  });
});

describe('encryptStoredDocuments (migration of old files)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ffi-docmig-'));
    useKeys();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  const name = 'ab' + '0123456789abcdef'.repeat(4).slice(0, 62);
  const shard = name.slice(0, 2);
  const rel = `${shard}/${name}`;

  const age = (path: string, seconds: number) => {
    const t = new Date(Date.now() - seconds * 1000);
    return utimes(path, t, t);
  };

  it('seals plaintext files in place, skips sealed ones, ignores strangers, and is idempotent', async () => {
    await mkdir(join(root, shard), { recursive: true });
    await writeFile(join(root, rel), PDF);
    await age(join(root, rel), 3600);
    await writeFile(join(root, 'README.txt'), 'not ours');

    const first = await encryptStoredDocuments(root);
    expect(first).toEqual({ encrypted: 1, alreadySealed: 0, skipped: 1 });
    const sealed = await readFile(join(root, rel));
    expect(sealed.subarray(0, 8).toString('latin1')).toBe('FFIDOC1\0');
    expect(await readdir(join(root, shard))).toEqual([name]); // no temp left behind
    expect(await readFile(join(root, 'README.txt'), 'utf8')).toBe('not ours');

    await age(join(root, rel), 3600);
    const second = await encryptStoredDocuments(root);
    expect(second).toEqual({ encrypted: 0, alreadySealed: 1, skipped: 1 });
    expect((await readFile(join(root, rel))).equals(sealed)).toBe(true);
  });

  it('does not touch anything when no key is configured', async () => {
    noKeys();
    await mkdir(join(root, shard), { recursive: true });
    await writeFile(join(root, rel), PDF);
    await expect(encryptStoredDocuments(root)).rejects.toThrow(/not configured/);
    expect(new Uint8Array(await readFile(join(root, rel)))).toEqual(PDF);
  });

  it('skips and logs a file modified under 60s ago, since a live upload may still own it', async () => {
    await mkdir(join(root, shard), { recursive: true });
    await writeFile(join(root, rel), PDF);
    await age(join(root, rel), 5);
    const log = vi.fn();
    const result = await encryptStoredDocuments(root, { log });
    expect(result).toEqual({ encrypted: 0, alreadySealed: 0, skipped: 1 });
    expect(new Uint8Array(await readFile(join(root, rel)))).toEqual(PDF);
    expect(log.mock.calls.flat().join(' ')).toContain(rel);
  });

  it('keeps the original file mode and leaves a file that opens back to the original bytes', async () => {
    await mkdir(join(root, shard), { recursive: true });
    await writeFile(join(root, rel), PDF);
    await chmod(join(root, rel), 0o640);
    await age(join(root, rel), 3600);
    await encryptStoredDocuments(root);
    expect((await stat(join(root, rel))).mode & 0o777).toBe(0o640);
    useKeys();
    const db = fakePrisma();
    db.documents.push({
      id: 'd1', uploadedById: 'fr', campaignId: null, partnerOrganisationId: null,
      contentType: 'application/pdf', storagePath: rel,
    });
    const got = await readDocument(db.prisma as never, { documentId: 'd1', viewer, root });
    expect(new Uint8Array(got!.bytes)).toEqual(PDF);
  });
});
