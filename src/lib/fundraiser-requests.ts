/**
 * The calls a Fundraiser's manage screen makes to the existing Campaign
 * routes (tickets 72, 65). Each resolves to null on success or to the
 * Indonesian refusal to show, the way verification-submission.ts does.
 * Browser-safe: no Prisma values.
 */

async function send(method: 'POST' | 'PATCH', url: string, body: unknown, fallback: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const refusal = await res.json().catch(() => ({}));
    return typeof refusal.error === 'string' && refusal.error !== '' ? refusal.error : fallback;
  } catch {
    return fallback;
  }
}

/** Edits a Draft or Rejected Campaign through PATCH /api/campaigns/[slug]. */
export function saveCampaignEdit(slug: string, fields: Record<string, unknown>): Promise<string | null> {
  return send('PATCH', `/api/campaigns/${slug}`, fields, 'Gagal menyimpan perubahan campaign.');
}

/** Asks for a new target and/or deadline on an Active Campaign. */
export function askForCampaignChange(
  slug: string,
  changes: { targetAmount?: number; deadline?: string | null },
): Promise<string | null> {
  return send('POST', `/api/campaigns/${slug}/change-requests`, changes, 'Gagal mengajukan perubahan campaign.');
}

/** Marks an Active Campaign Completed; the owner needs no reason. */
export function completeCampaignRequest(slug: string): Promise<string | null> {
  return send('POST', `/api/campaigns/${slug}/complete`, {}, 'Gagal menandai campaign selesai.');
}

/** Asks an Admin to cancel an Active Campaign. */
export function askForCancellation(slug: string, reason: string): Promise<string | null> {
  return send('POST', `/api/campaigns/${slug}/cancellation-requests`, { reason }, 'Gagal mengajukan pembatalan campaign.');
}
