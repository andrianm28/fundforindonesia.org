/**
 * Catalogue ordering (PKS Pasal 3.7): `?sort=` on GET /api/campaigns and the
 * order picker on the explore page.
 *
 * - `terbaru`: newest first (the default, as before).
 * - `segera-berakhir`: nearest deadline first, Campaigns without a deadline
 *   (wakaf) last. Read straight from the database through the existing
 *   (lifecycleStatus, deadline) index.
 * - `hampir-tercapai` and `terbanyak`: ranked on the COUNTED collected amount
 *   (counted-payment.ts), not on the stored counter, which still holds
 *   sandbox money. That figure only exists after `withCountedCollectedAmount`,
 *   so these two are ranked here over a slim projection and the page is then
 *   read by id.
 */
export const CAMPAIGN_SORTS = ['terbaru', 'hampir-tercapai', 'terbanyak', 'segera-berakhir'] as const;
export type CampaignSort = (typeof CAMPAIGN_SORTS)[number];
export const DEFAULT_CAMPAIGN_SORT: CampaignSort = 'terbaru';

export const CAMPAIGN_SORT_LABEL: Record<CampaignSort, string> = {
  terbaru: 'Terbaru',
  'hampir-tercapai': 'Hampir tercapai',
  terbanyak: 'Paling banyak terkumpul',
  'segera-berakhir': 'Segera berakhir',
};

/** The order a query string names: the default when absent, null when unknown. */
export function parseCampaignSort(value: string | null): CampaignSort | null {
  if (value === null || value === '') return DEFAULT_CAMPAIGN_SORT;
  return (CAMPAIGN_SORTS as readonly string[]).includes(value) ? (value as CampaignSort) : null;
}

export interface RankableCampaign {
  id: string;
  /** The counted figure (withCountedCollectedAmount), not the stored counter. */
  collectedAmount: number;
  targetAmount: number;
  createdAt: Date;
}

/**
 * `hampir-tercapai`: the larger the share of the target collected, the nearer;
 * a Campaign already at or past its target is no longer "almost there", so it
 * follows every one that is still short. `terbanyak`: the larger amount first.
 * Ties go to the newer Campaign, then by id, so a page boundary is stable.
 */
export function rankByCountedProgress<T extends RankableCampaign>(
  rows: T[],
  sort: 'hampir-tercapai' | 'terbanyak',
): T[] {
  const share = (r: T) => (r.targetAmount > 0 ? r.collectedAmount / r.targetAmount : 0);
  const key = (r: T): [number, number] =>
    sort === 'terbanyak' ? [0, r.collectedAmount] : share(r) >= 1 ? [0, 0] : [1, share(r)];
  return [...rows].sort((a, b) => {
    const [ag, av] = key(a);
    const [bg, bv] = key(b);
    return (
      bg - ag ||
      bv - av ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  });
}
