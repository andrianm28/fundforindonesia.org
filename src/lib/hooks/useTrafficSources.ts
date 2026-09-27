import { useEffect, useState } from 'react';

export interface TrafficSourceCount {
  source: string | null;
  count: number;
}

/**
 * Traffic Source counts (ticket 24, "Counts per link are visible to the
 * Fundraiser"), asked of GET /api/campaigns/[slug]/traffic-sources -- which
 * answers only that Campaign's Fundraiser or an Admin. Anything else (a
 * stranger's 403, a network failure) resolves to null, the same as "nothing
 * to show" -- the Campaign page is cached for every visitor alike
 * (CampaignDetailView's caller), so a caller renders nothing rather than an
 * error when this stays null.
 */
export function useTrafficSources(slug: string): TrafficSourceCount[] | null {
  const [sources, setSources] = useState<TrafficSourceCount[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    try {
      fetch(`/api/campaigns/${slug}/traffic-sources`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled) return;
          if (Array.isArray(data?.sources)) setSources(data.sources);
        })
        .catch(() => {
          // Nothing to show; the panel stays hidden.
        });
    } catch {
      // fetch() itself can throw synchronously (e.g. an unparseable URL in
      // a non-browser test environment) -- same outcome, nothing to show.
    }
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return sources;
}
