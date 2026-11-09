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
 * Idempotent and safe to stop and re-run: each file is written to a temp file
 * in its own directory and renamed over the original, files already sealed are
 * left alone, and anything that is not a stored document is never touched.
 * Back up the volume first (docs/runbooks/backup-dan-restore.md). Exits 1 on
 * failure.
 */

async function main() {
  const root = documentRoot();
  if (!root) throw new Error('PRIVATE_DOCUMENT_DIR is not set');
  const result = await encryptStoredDocuments(root);
  console.log(
    `Done: ${result.encrypted} encrypted, ${result.alreadySealed} already sealed, ${result.skipped} skipped (${root}).`,
  );
}

main().catch((error) => {
  console.error('Document encryption failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
