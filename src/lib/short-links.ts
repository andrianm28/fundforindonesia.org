import { randomInt } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { effectiveStatus } from '@/lib/subject-guard';
import { isPubliclyViewable } from '@/lib/campaign-visibility';

/**
 * Short links (ticket E1/02, PRD FFI-06; owner decision 2026-10-04: a
 * prefix on the apex domain, `/s/<code>`, no separate domain). A short link
 * stands in for the long `/campaign/<slug>?src=<channel>` link ShareModal
 * hands out, and redirects to exactly that, so the Traffic Source still
 * travels as `?src=` and is recorded on the Donation by the same
 * sanitizing path (src/lib/traffic-source.ts) a long link takes.
 */

/**
 * The share channels ShareModal offers, which are also the only sources a
 * short link is ever made for. A fixed list on purpose: the endpoint that
 * makes links is public, and this caps what anyone can make it write at one
 * row per channel per Campaign.
 */
export const SHARE_CHANNELS = ['whatsapp', 'facebook', 'twitter', 'copy'] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

/** No 0/O, 1/l/I: a code read aloud or retyped from a poster survives. */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const WELL_FORMED = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

/** Fresh codes to try before giving up; at 57^8 a second try is already rare. */
const MAX_CODE_ATTEMPTS = 5;

/** A random code from a CSPRNG, so codes cannot be walked to list Campaigns. */
export function generateShortCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Whether `code` could be a code at all; anything else never reaches the database. */
export function isWellFormedShortCode(code: string): boolean {
  return WELL_FORMED.test(code);
}

/** The path a short link lives at, relative to the public site (publicUrl()). */
export function shortLinkPath(code: string): string {
  return `/s/${code}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/**
 * One code per share channel for this Campaign: the existing ones, plus a
 * new one for each channel that has none yet. Stable once made, so a link
 * already in a WhatsApp group keeps working and keeps counting.
 *
 * Two shares of the same Campaign can race to create the same channel;
 * the (campaignId, source) unique index keeps the first, and the loser
 * takes that one. A unique violation with no such winner was the random
 * code colliding, and gets a fresh code.
 */
export async function ensureShareLinks(campaignId: string): Promise<Record<ShareChannel, string>> {
  const existing = await prisma.shortLink.findMany({
    where: { campaignId, source: { in: [...SHARE_CHANNELS] } },
    select: { source: true, code: true },
  });
  const codes = new Map(existing.map((row) => [row.source, row.code]));

  for (const source of SHARE_CHANNELS) {
    if (codes.has(source)) continue;
    codes.set(source, await createShareLink(campaignId, source));
  }

  return Object.fromEntries(SHARE_CHANNELS.map((source) => [source, codes.get(source)!])) as Record<
    ShareChannel,
    string
  >;
}

async function createShareLink(campaignId: string, source: ShareChannel): Promise<string> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateShortCode();
    try {
      await prisma.shortLink.create({ data: { campaignId, source, code } });
      return code;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const winner = await prisma.shortLink.findUnique({
        where: { campaignId_source: { campaignId, source } },
        select: { code: true },
      });
      if (winner) return winner.code;
    }
  }
  throw new Error(`Could not find a free short link code for ${source}`);
}

/**
 * Where a short link goes: the Campaign page, relative, with the link's
 * source as `src`, or null when there is nowhere to go. Null for a code
 * that is malformed, unknown, or points at a Campaign that is not public
 * (Draft, Submitted, Rejected): a short link is shared with strangers, so
 * it never opens what a stranger may not see, and never says it exists.
 *
 * Counts the visit. A failed count never costs the visitor the redirect.
 */
export async function followShortLink(code: string, now: Date): Promise<string | null> {
  if (!isWellFormedShortCode(code)) return null;

  const link = await prisma.shortLink.findUnique({
    where: { code },
    select: {
      id: true,
      source: true,
      campaign: { select: { slug: true, lifecycleStatus: true, deadline: true } },
    },
  });
  if (!link) return null;
  if (!isPubliclyViewable(effectiveStatus(link.campaign, now))) return null;

  try {
    await prisma.shortLink.update({ where: { id: link.id }, data: { clickCount: { increment: 1 } } });
  } catch (error) {
    console.error('Error counting short link visit:', error);
  }

  return `/campaign/${encodeURIComponent(link.campaign.slug)}?src=${encodeURIComponent(link.source)}`;
}
