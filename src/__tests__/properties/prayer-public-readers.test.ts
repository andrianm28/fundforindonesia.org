import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A hidden or deleted Prayer never reaches a visitor (PKS pemenuhan 10, Pasal
 * 3.7c). Every application file that reads the Prayer table is listed here
 * with the reason it may, and each PUBLIC reader must go through the one rule
 * in src/lib/prayer-moderation.ts (`publicPrayerWhere` for a query,
 * `isPublicPrayer` for a row in hand). A new reader of `prisma.prayer` is a
 * reviewer's call, made visibly in this diff.
 */
const PUBLIC_READERS: Record<string, RegExp> = {
  // The Campaign page's Prayer list and the platform-wide feed.
  'src/app/api/prayers/route.ts': /\bpublicPrayerWhere\(/,
  // The Prayer Wall on the home page.
  'src/app/page.tsx': /\bpublicPrayerWhere\(/,
  // Aamiin on a Prayer a visitor can no longer see is refused as not found.
  'src/app/api/prayers/[id]/amiin/route.ts': /\bisPublicPrayer\(/,
  // The Admin's curation screen offers only Prayers a visitor can see today as
  // candidates for "Sorotan doa" (PKS pemenuhan 15).
  'src/app/admin/kurasi/page.tsx': /\bpublicPrayerWhere\(/,
};

const NON_PUBLIC_READERS = [
  // Moderators see hidden Prayers by design; the module owns who and how.
  'src/lib/prayer-moderation.ts',
  // Writes the Prayer with the Donation, and reads nothing back to a visitor.
  'src/app/api/donations/route.ts',
  // Removes the Donor's link from their own Prayer; shows nothing.
  'src/lib/donor-anonymisation.ts',
  // The Admin's "Sorotan doa" marks (PKS pemenuhan 15): checks that a Prayer an
  // Admin marks exists and is not deleted, and shows nothing to a visitor. The
  // public read of the marks goes through `prayerHighlight` and is pinned below.
  'src/lib/home-curation.ts',
];

const READS_PRAYERS = /\bprisma\.prayer\b|\btx\.prayer\b|\bdb\.prayer\b/;

function applicationFiles(dir = 'src'): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return full === join('src', 'generated') ? [] : applicationFiles(full);
    return /\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full) ? [full] : [];
  });
}

describe('every reader of the Prayer table is accounted for', () => {
  it('no other application file touches it', () => {
    const readers = applicationFiles().filter((file) => READS_PRAYERS.test(readFileSync(file, 'utf8')));
    expect(readers.sort()).toEqual([...Object.keys(PUBLIC_READERS), ...NON_PUBLIC_READERS].sort());
  });

  it.each(Object.entries(PUBLIC_READERS))('%s applies the public Prayer rule', (file, rule) => {
    expect(readFileSync(file, 'utf8')).toMatch(rule);
  });
});

describe('"Sorotan doa" (PKS pemenuhan 15) shows only Prayers that pass the public rule', () => {
  // The public reader of the marks reads the PrayerHighlight table, not
  // `prisma.prayer`, so the scan above cannot see it: pin it here.
  it('the home page reads the marked Prayers through publicPrayerWhere', () => {
    const source = readFileSync('src/lib/home-curation.ts', 'utf8');
    const reader = source.slice(source.indexOf('export async function loadHighlightedPrayers'));
    expect(reader).toMatch(/prayer:\s*\{\s*\.\.\.publicPrayerWhere\(\)/);
  });
});
