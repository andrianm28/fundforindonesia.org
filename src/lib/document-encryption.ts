import { randomBytes } from 'crypto';
import { open, readdir, readFile, rename, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { requireFieldKeys } from './contact-fields';
import type { FieldKeys } from './field-encryption';

/**
 * Private document bytes sealed at rest (PKS contract 10(4), ticket 14).
 *
 * Same AES-256-GCM key material and rotation scheme as ADR 0012: the file is
 * sealed under the current FIELD_ENCRYPTION_KEY, and the key id it names in
 * its header lets a retired key (FIELD_ENCRYPTION_PREVIOUS_KEYS) still open
 * it. No separate secret and no schema change. The AAD is
 * `Document.file:<storagePath>`, which separates this use from the contact
 * columns' (`User.email` and so on) and stops a valid sealed file from being
 * copied over another document's path.
 *
 * File layout: "FFIDOC1\0" (8) | key id length (1) | key id | iv (12) |
 * ciphertext | tag (16). Plaintext never starts with the magic: documents are
 * sniffed to be a PDF or image on the way in (`%PDF-`, FFD8, PNG, RIFF), so a
 * file without the header is one written before this change and is served
 * as is. Anyone who can write files on the volume could plant such a file;
 * encryption at rest defends a copied disk or backup, not a hostile host.
 *
 * Public uploads (src/lib/uploads.ts, campaign covers) are public by design,
 * live under public/uploads and are deliberately NOT sealed.
 */

const MAGIC = Buffer.from('FFIDOC1\0', 'latin1');

export class DocumentIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentIntegrityError';
  }
}

const aadFor = (storagePath: string) => `Document.file:${storagePath}`;

export function isSealedDocument(file: Uint8Array): boolean {
  return file.length >= MAGIC.length && MAGIC.equals(Buffer.from(file.buffer, file.byteOffset, MAGIC.length));
}

export function sealDocumentBytes(keys: FieldKeys, storagePath: string, bytes: Uint8Array): Buffer {
  const { sealed, keyId } = keys.encryptBytes(aadFor(storagePath), Buffer.from(bytes));
  const id = Buffer.from(keyId, 'utf8');
  if (id.length === 0 || id.length > 255) throw new Error('Field encryption key id must be 1 to 255 bytes');
  return Buffer.concat([MAGIC, Buffer.from([id.length]), id, sealed]);
}

/** Plaintext of a stored file. A file without the header is returned unchanged; a sealed one that does not verify throws. */
export function openDocumentBytes(keys: FieldKeys, storagePath: string, file: Buffer): Buffer {
  if (!isSealedDocument(file)) return file;
  try {
    const idLength = file[MAGIC.length];
    const idStart = MAGIC.length + 1;
    if (!idLength || file.length < idStart + idLength) throw new Error('truncated header');
    const keyId = file.subarray(idStart, idStart + idLength).toString('utf8');
    return keys.decryptBytes(aadFor(storagePath), file.subarray(idStart + idLength), keyId);
  } catch (error) {
    throw new DocumentIntegrityError(
      `Stored document ${storagePath} failed verification: ${error instanceof Error ? error.message : 'unreadable'}`,
    );
  }
}

const SHARD = /^[0-9a-f]{2}$/;
const NAME = /^[0-9a-f]{64}$/;

export type EncryptStoredResult = { encrypted: number; alreadySealed: number; skipped: number };

export type EncryptStoredOptions = {
  /** Files modified more recently than this are left to the live app (default 60s). */
  minAgeMs?: number;
  log?: (message: string) => void;
};

/** fsync a directory so a rename in it survives a crash. Best effort where the platform refuses. */
async function syncDirectory(dir: string): Promise<void> {
  let handle;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EINVAL' && code !== 'EISDIR' && code !== 'EPERM') throw error;
  } finally {
    await handle?.close();
  }
}

/**
 * Seals every plaintext document under `root` in place. Run it with
 * maintenance mode on: a file modified in the last `minAgeMs` (60s) is skipped
 * and logged, and one that changes while it is being sealed is abandoned, but
 * only maintenance mode really stops a live upload racing the rename.
 *
 * Per file: seal to a temp file in the same directory (original mode and
 * owner), fsync it, decrypt it again and compare with the original bytes, and
 * only then rename over the original and fsync the directory, so a crash
 * leaves the old file or a verified new one. Idempotent: sealed files are left
 * alone. Anything that is not a `<2 hex>/<64 hex>` file is counted as skipped
 * and never touched. Refuses to start without a key.
 */
export async function encryptStoredDocuments(
  root: string,
  options: EncryptStoredOptions = {},
): Promise<EncryptStoredResult> {
  const keys = requireFieldKeys();
  const minAgeMs = options.minAgeMs ?? 60_000;
  const log = options.log ?? (() => undefined);
  const result: EncryptStoredResult = { encrypted: 0, alreadySealed: 0, skipped: 0 };

  for (const shard of await readdir(root, { withFileTypes: true })) {
    if (!shard.isDirectory() || !SHARD.test(shard.name)) {
      result.skipped += 1;
      continue;
    }
    const dir = join(root, shard.name);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !NAME.test(entry.name) || !entry.name.startsWith(shard.name)) {
        result.skipped += 1;
        continue;
      }
      const storagePath = `${shard.name}/${entry.name}`;
      const full = join(dir, entry.name);
      const before = await stat(full).catch(() => null);
      if (!before) {
        log(`skipped ${storagePath}: removed before it could be read`);
        result.skipped += 1;
        continue;
      }
      if (Date.now() - before.mtimeMs < minAgeMs) {
        log(`skipped ${storagePath}: modified under ${Math.round(minAgeMs / 1000)}s ago (live upload?)`);
        result.skipped += 1;
        continue;
      }
      const current = await readFile(full);
      if (isSealedDocument(current)) {
        result.alreadySealed += 1;
        continue;
      }
      const sealed = sealDocumentBytes(keys, storagePath, current);
      const temp = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
      try {
        const handle = await open(temp, 'wx', before.mode & 0o777);
        try {
          await handle.writeFile(sealed);
          await handle.chmod(before.mode & 0o777);
          try {
            await handle.chown(before.uid, before.gid);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
            log(`warning: could not keep owner ${before.uid}:${before.gid} on ${storagePath} (EPERM)`);
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
        // The sealed copy must open back to exactly the bytes it replaces.
        const roundTrip = openDocumentBytes(keys, storagePath, await readFile(temp));
        if (!roundTrip.equals(current)) throw new Error(`Sealed copy of ${storagePath} does not match the original`);
        // A write that landed since we read it would be lost by the rename.
        const after = await stat(full).catch(() => null);
        if (!after || after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
          await unlink(temp).catch(() => undefined);
          log(`skipped ${storagePath}: changed while being sealed`);
          result.skipped += 1;
          continue;
        }
        await rename(temp, full);
        await syncDirectory(dir);
      } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
      }
      result.encrypted += 1;
    }
  }
  return result;
}
