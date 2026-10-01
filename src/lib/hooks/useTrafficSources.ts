import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

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
 *
 * The route stays owner-or-admin only on purpose; this hook just does not
 * ask when the viewer cannot be answered (an anonymous visitor, or a
 * signed-in stranger), so no 403 lands in the browser console on every
 * Campaign page view (UAT round 1). Whether to ask is decided from the
 * session: the Campaign's creator, or someone holding the ADMIN assignment.
 * The server still decides what is answered.
 */
export function useTrafficSources(slug: string, creatorId: string): TrafficSourceCount[] | null {
  const [sources, setSources] = useState<TrafficSourceCount[] | null>(null);
  const { data: session } = useSession();
  const viewerId = session?.user?.id;
  const mayAsk =
    !!viewerId && (viewerId === creatorId || (session?.user?.assignments ?? []).includes('ADMIN'));

  useEffect(() => {
    if (!mayAsk) return;
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
  }, [slug, mayAsk]);

  return sources;
}
