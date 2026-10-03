'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CampaignDetailView,
  type CampaignDetailData,
} from '@/components/campaign/CampaignDetailView';

type Lookup =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'failed' }
  | { state: 'found'; campaign: CampaignDetailData };

/**
 * Shown, with a 404 status, wherever ./page.tsx calls notFound(): for a slug
 * that does not exist and for every unapproved Campaign (Draft, Submitted,
 * Rejected). The page is ISR and cannot know who is looking, so it never
 * renders an unapproved Campaign itself, and what it caches holds nothing of
 * one.
 *
 * Here, in the viewer's browser, the session-aware GET /api/campaigns/[slug]
 * is asked instead. It answers the Campaign only to its Fundraiser,
 * Verifiers and Admins, as `private, no-store`, and the same 404 as a
 * missing slug to anyone else (CONTEXT.md, Campaign Status).
 */
export default function CampaignNotFound() {
  const params = useParams();
  const slug = typeof params?.slug === 'string' ? params.slug : '';
  // The answer for the slug it was asked about. Until it matches the current
  // slug the lookup is loading; an empty slug has nothing to ask and is missing.
  const [answer, setAnswer] = useState<{ slug: string; lookup: Lookup } | null>(null);
  const lookup: Lookup = !slug
    ? { state: 'missing' }
    : answer?.slug === slug
      ? answer.lookup
      : { state: 'loading' };

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    fetch(`/api/campaigns/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(async (res) => {
        if (res.status === 404) return { state: 'missing' } as const;
        if (!res.ok) return { state: 'failed' } as const;
        const body = await res.json();
        const campaign = body?.campaign as CampaignDetailData | undefined;
        return campaign ? ({ state: 'found', campaign } as const) : ({ state: 'missing' } as const);
      })
      .catch(() => ({ state: 'failed' }) as const)
      .then((next: Lookup) => {
        if (!cancelled) setAnswer({ slug, lookup: next });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (lookup.state === 'found') {
    return <CampaignDetailView campaign={lookup.campaign} />;
  }

  if (lookup.state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-text-secondary">Memuat...</div>
      </div>
    );
  }

  // A failure is not an answer: a privileged viewer must not be told their
  // Campaign is missing because the API was briefly unreachable.
  if (lookup.state === 'failed') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center">
        <p className="text-text-secondary">Gagal memuat Campaign. Coba muat ulang halaman.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold text-text">Campaign tidak ditemukan</h1>
      <p className="text-text-secondary text-sm">
        Tautan ini mungkin salah, atau Campaign-nya tidak tersedia untuk publik.
      </p>
      <Link href="/" className="text-primary font-medium hover:underline">
        Kembali ke beranda
      </Link>
    </div>
  );
}
