import { useEffect, useState } from 'react';
import type { CampaignLifecycleStatus } from '@/types/campaign';
import { withdrawFromVerifier } from '@/lib/verification-submission';

export interface WithdrawableSubmission {
  /**
   * The pending Verification Request's id, once known. `undefined` while
   * unknown or not applicable (not Submitted, or the viewer is not the
   * owning Fundraiser); `null` once there is none to withdraw (already
   * decided elsewhere, or just withdrawn).
   */
  requestId: string | null | undefined;
  pending: boolean;
  refusal: string;
  withdraw: () => void;
}

/**
 * The Verification Request a Submitted Campaign's Fundraiser may withdraw
 * from their own Campaign page (verification-request 10), and the
 * withdraw action itself.
 *
 * GET /api/campaigns/[slug] returns `pendingVerificationRequestId` only to
 * the owning Fundraiser (mirrors ./useSuspensionReason.ts), so a Verifier
 * or Admin viewing the same page never gets a truthy `requestId` here:
 * viewing is not acting, and withdrawing is the Fundraiser's alone.
 */
export function useWithdrawableSubmission(
  slug: string,
  status: CampaignLifecycleStatus,
  onWithdrawn: (nextStatus: CampaignLifecycleStatus) => void
): WithdrawableSubmission {
  const [requestId, setRequestId] = useState<string | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState('');

  useEffect(() => {
    if (status !== 'SUBMITTED') return;
    let cancelled = false;
    fetch(`/api/campaigns/${slug}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const value = data?.campaign?.pendingVerificationRequestId;
        if (!cancelled) setRequestId(typeof value === 'string' ? value : null);
      })
      .catch(() => {
        // No button shown; the banner alone still stands.
      });
    return () => {
      cancelled = true;
    };
  }, [slug, status]);

  async function withdraw() {
    if (!requestId) return;
    setPending(true);
    setRefusal('');
    const refused = await withdrawFromVerifier(slug, requestId);
    setPending(false);
    if (refused) {
      setRefusal(refused);
      return;
    }
    setRequestId(null);
    try {
      const res = await fetch(`/api/campaigns/${slug}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const nextStatus = data?.campaign?.lifecycleStatus;
        if (typeof nextStatus === 'string') {
          onWithdrawn(nextStatus as CampaignLifecycleStatus);
        }
      }
    } catch {
      // The status shown stays as-is; reloading the page picks up the truth.
    }
  }

  return { requestId, pending, refusal, withdraw };
}
