import { findPrismaFieldReferences } from './prisma-field-references';

/**
 * Every place in `src` (tests and generated code excluded), and in any
 * `alsoScan` file, that names the legacy Campaign `status` column. Only the
 * Campaign model among the Campaign* models has a `status` field, which is
 * what findPrismaFieldReferences needs to attribute it.
 */
export function findCampaignStatusReferences({
  root,
  alsoScan,
}: { root?: string; alsoScan?: string[] } = {}): string[] {
  return findPrismaFieldReferences({ model: 'Campaign', fields: ['status'], root, alsoScan });
}
