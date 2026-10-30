'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { completeCampaignRequest, requestCancellation } from '@/lib/fundraiser-requests';

/**
 * The two ways a Fundraiser ends an Active Campaign (ticket 65): marking it
 * Completed, and asking an Admin to cancel it. Both go through the existing
 * routes; the rules (a Campaign Update is needed to complete, one pending
 * cancellation at a time) are the commands', and their refusals are shown as
 * sent. The page offers this only for an Active Campaign.
 */
export function CampaignCloseActions({
  slug,
  hasUpdate,
  cancellationPending,
}: {
  slug: string;
  /** The Campaign has at least one Campaign Update, which Completed requires. */
  hasUpdate: boolean;
  /** A Cancellation request already waits for an Admin. */
  cancellationPending: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completeRefusal, setCompleteRefusal] = useState('');
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelRefusal, setCancelRefusal] = useState('');

  async function complete() {
    setCompleting(true);
    setCompleteRefusal('');
    const refused = await completeCampaignRequest(slug);
    setCompleting(false);
    if (refused) setCompleteRefusal(refused);
    else router.refresh();
  }

  async function cancel() {
    setCancelRefusal('');
    if (!reason.trim()) {
      setCancelRefusal('Alasan pembatalan harus diisi.');
      return;
    }
    setCancelling(true);
    const refused = await requestCancellation(slug, reason.trim());
    setCancelling(false);
    if (refused) setCancelRefusal(refused);
    else router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-xl shadow-xs p-4" aria-labelledby="complete-heading">
        <h2 id="complete-heading" className="text-sm font-semibold text-text">
          Tandai Selesai
        </h2>
        <p className="text-xs text-text-secondary mt-1">
          Campaign tidak lagi menerima donasi dan tidak dapat dibuka kembali. Dana yang terkumpul tetap dapat dicairkan.
        </p>
        {!hasUpdate && (
          <p data-testid="complete-needs-update" className="text-xs text-[#C62828] mt-2">
            Campaign harus punya minimal satu Campaign Update sebelum dapat ditandai selesai. Tulis kabar terbaru
            untuk para donatur dulu.
          </p>
        )}
        {completeRefusal && (
          <p role="alert" className="text-sm text-danger mt-2">
            {completeRefusal}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          {confirming ? (
            <>
              <Button variant="primary" size="md" onClick={complete} isLoading={completing} disabled={completing}>
                Ya, tandai selesai
              </Button>
              <Button variant="secondary" size="md" onClick={() => setConfirming(false)} disabled={completing}>
                Batal
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="md" onClick={() => setConfirming(true)}>
              Tandai Selesai
            </Button>
          )}
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-xs p-4" aria-labelledby="cancel-heading">
        <h2 id="cancel-heading" className="text-sm font-semibold text-text">
          Ajukan pembatalan
        </h2>
        {cancellationPending ? (
          <p data-testid="cancellation-waiting" className="text-sm text-text-secondary mt-2">
            Pengajuan pembatalan Anda sedang menunggu keputusan Admin. Campaign tetap Active dan menerima donasi
            sampai Admin memutuskan.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="text-xs text-text-secondary">
              Admin yang memutuskan. Selama menunggu, Campaign tetap Active dan menerima donasi.
            </p>
            <div>
              <label htmlFor="cancellation-reason" className="block text-sm font-medium text-text mb-1.5">
                Alasan pembatalan
              </label>
              <textarea
                id="cancellation-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2.5 text-sm rounded-md border border-border hover:border-text-secondary/50 focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            {cancelRefusal && (
              <p role="alert" className="text-sm text-danger">
                {cancelRefusal}
              </p>
            )}
            <Button variant="danger" size="md" onClick={cancel} isLoading={cancelling} disabled={cancelling}>
              Ajukan Pembatalan
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
