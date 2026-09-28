import type { CampaignLifecycleStatus } from '@/types/campaign';

/**
 * The Campaign statuses a Payout may be requested or approved in
 * (CONTEXT.md, Payout): effectively Active, Expired or Completed. Suspended
 * and Cancelled refuse, and so does every status before the Campaign has been
 * approved -- a Draft has raised nothing to pay out.
 *
 * Free of Prisma values, so a browser bundle can ask the same question the
 * server enforces. `requirePayoutAllowed` in ./subject-guard.ts is written
 * against this list rather than keeping its own copy, so the statuses a screen
 * offers and the statuses the money layer accepts cannot drift apart: there
 * is one list, and a status added to one is added to both.
 *
 * A page uses this to decide whether to OFFER the request, never to decide
 * whether it is allowed. The server judges every request again, under the
 * Campaign row lock, where a Suspension that committed a moment ago is seen.
 */
export const PAYOUT_REQUESTABLE_STATUSES: readonly CampaignLifecycleStatus[] = [
  'ACTIVE',
  'EXPIRED',
  'COMPLETED',
];
