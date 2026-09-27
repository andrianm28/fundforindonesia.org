import 'dotenv/config';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { runContactFieldBackfill } from '@/lib/backfill';

/**
 * Fills the protected contact columns ADR 0012 added, for rows written before
 * the keys were configured (prd-compliance 16).
 *
 *   npx tsx prisma/backfill-contact-fields.ts
 *
 * This runs BEFORE the deployment that applies
 * prisma/migrations/20260930010000_drop_contact_plaintext, not during it: that
 * migration refuses to run while any row still has a plaintext value with
 * nothing sealed for it, and this is what fills them. It is separate from the
 * migration for two reasons -- a SQL migration has no way to reach
 * FIELD_ENCRYPTION_KEY, and on a large database it may take long enough that
 * the owner wants to watch it rather than have a deploy step appear to hang.
 *
 * It reads plaintext and writes ciphertext, so it must run while the plaintext
 * columns still exist. Running it after the drop is not possible: there is
 * nothing left to read.
 *
 * Safe to run more than once, and safe to stop and re-run: it writes only rows
 * that are not sealed yet, and commits each row as it goes. It stops at the
 * first row it cannot seal rather than skipping it. Exits 1 on failure, so a
 * script that runs it does not carry on to the migration.
 *
 * Read src/lib/backfill.ts for what it does and why; this is the part that
 * needs a real database and the production keys.
 */

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    // A plain client, not the protected one: the backfill reads plaintext
    // columns the generated client no longer has, and its own writes are
    // already the sealed columns the hook would produce. A hook that stripped
    // a plaintext key here would be stripping nothing and hiding a mistake.
    await runContactFieldBackfill(
      {
        query: (sql, values) => prisma.$queryRawUnsafe(sql, ...values) as never,
        execute: async (sql, values) => prisma.$executeRawUnsafe(sql, ...values),
      },
      (message) => console.log(message),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: Error) => {
  // The one error worth explaining rather than printing: reaching this means
  // the contract migration has already run, so there is nothing left to read.
  if (/column "(email|phone|accountNumber|guestEmail|guestPhone|contactEmail|contactPhone)" does not exist/.test(error.message)) {
    console.error(
      'The plaintext contact columns are already gone, so there is nothing left to backfill: prisma/migrations/20260930010000_drop_contact_plaintext has been applied. If a row is unsealed, restore the pre-deploy dump on the host (ops/deploy.sh keeps one in backups/) and backfill before deploying again.',
    );
    process.exit(1);
  }
  console.error(error.message);
  process.exit(1);
});
