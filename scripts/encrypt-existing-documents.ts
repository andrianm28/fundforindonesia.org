import 'dotenv/config';
import { documentRoot } from '@/lib/documents';
import { encryptStoredDocuments } from '@/lib/document-encryption';

/**
 * Seals private documents written before ticket 14 (PKS 10(4)), in place.
 *
 *   npx tsx scripts/encrypt-existing-documents.ts
 *
 * Needs the same environment as the app: PRIVATE_DOCUMENT_DIR and the four
 * FIELD_* keys (runbook docs/runbooks/rotasi-kunci-field.md). Optional: the app
 * reads unsealed files fine, so nothing breaks if this is never run.
 *
 * RUN IT WITH MAINTENANCE MODE ON (Admin Panel > Operasional, docs/runbooks/
 * insiden.md): a live upload racing the final rename could be lost. As a
 * second line of defence, files modified in the last 60s are skipped and
 * logged, and a file that changes mid-seal is abandoned.
 *
 * Idempotent and safe to stop and re-run: each file is written to a temp file
 * in its own directory (original mode and owner kept), fsynced, decrypted again
 * and compared with the original, and only then renamed over it, with the
 * directory fsynced after. Files already sealed are left alone, and anything that is not a stored document is never touched.
 * Back up the volume first (docs/runbooks/backup-dan-restore.md). Exits 1 on
 * failure.
 */

async function main() {
  const root = documentRoot();
  if (!root) throw new Error('PRIVATE_DOCUMENT_DIR is not set');
  const result = await encryptStoredDocuments(root, { log: (message) => console.warn(message) });
  console.log(
    `Done: ${result.encrypted} encrypted, ${result.alreadySealed} already sealed, ${result.skipped} skipped (${root}).`,
  );
}

main().catch((error) => {
  console.error('Document encryption failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
