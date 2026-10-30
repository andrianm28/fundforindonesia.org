import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { effectiveStatus } from '@/lib/subject-guard';
import { isPubliclyViewable } from '@/lib/campaign-visibility';
import { campaignNotFound } from '@/lib/campaign-visibility-route';
import { ensureShareLinks, shortLinkPath, SHARE_CHANNELS } from '@/lib/short-links';
import { publicUrl } from '@/lib/public-url';

export const dynamic = 'force-dynamic';

/**
 * POST /api/campaigns/[slug]/short-links (ticket E1/02, PRD FFI-06): the
 * short link for each share channel, made on first share and reused after.
 * Asks for no session: anyone may share a public Campaign, the long link
 * needs none either, and what this can write is capped at one row per
 * share channel per Campaign (SHARE_CHANNELS). Only a public Campaign gets
 * links -- a short link is for strangers, so even the Fundraiser of a Draft
 * gets the 404 here, the same one a missing slug gets.
 */
export async function POST(_request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;

    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true, lifecycleStatus: true, deadline: true },
    });
    if (!campaign || !isPubliclyViewable(effectiveStatus(campaign, new Date()))) return campaignNotFound();

    const codes = await ensureShareLinks(campaign.id);
    const links = Object.fromEntries(
      SHARE_CHANNELS.map((channel) => [channel, publicUrl(shortLinkPath(codes[channel]))]),
    );

    return NextResponse.json({ links });
  } catch (error) {
    console.error('Error creating short links:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server', status: 500 },
      { status: 500 },
    );
  }
}
