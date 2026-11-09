'use client';

import { useEffect, useState } from 'react';
import type { PrayerStreamItem } from '@/lib/hooks/usePrayerStream';
import { CampaignPrayers, PRAYER_PAGE_SIZE, toPrayerStreamItem } from './CampaignPrayers';

/**
 * The "Doa" tab of the Campaign page: the donors' prayers for this Campaign,
 * each with its Aamiin button. GET /api/prayers already leaves out hidden and
 * deleted prayers (src/lib/prayer-moderation.ts) and names an anonymous donor
 * as nobody, so this only fetches the first page and hands it to
 * CampaignPrayers, which loads the rest. A failed request reads as no prayers
 * rather than an error: the tab is secondary to giving.
 */
export function CampaignPrayersTab({ slug }: { slug: string }) {
  const [prayers, setPrayers] = useState<PrayerStreamItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/prayers?campaignSlug=${encodeURIComponent(slug)}&page=1&limit=${PRAYER_PAGE_SIZE}`)
      .then((res) => (res.ok ? res.json() : { prayers: [] }))
      .then((body: { prayers?: Record<string, unknown>[] }) => {
        if (!cancelled) setPrayers((body.prayers ?? []).map(toPrayerStreamItem));
      })
      .catch(() => {
        if (!cancelled) setPrayers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (prayers === null) return <p className="text-sm text-text-secondary">Memuat...</p>;
  return <CampaignPrayers campaignSlug={slug} initialPrayers={prayers} />;
}
