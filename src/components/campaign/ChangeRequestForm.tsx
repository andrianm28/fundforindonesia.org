'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CampaignDeadlineField } from '@/components/campaign/CampaignDeadlineField';
import type { CampaignKind } from '@/lib/campaign-kind';
import { deadlineError, formatRupiahInput, parseRupiahInput } from '@/lib/campaign-form';
import { requestCampaignChange } from '@/lib/fundraiser-requests';
import { endOfWibDay } from '@/lib/utils/date';

/**
 * An Active Campaign asks for a new target and/or deadline (ticket 72, PRD
 * FFI-05). Opens a Verification Request through
 * POST /api/campaigns/[slug]/change-requests; the Campaign keeps its old
 * values until a Verifier approves. Sends only what differs from now.
 */
export function ChangeRequestForm({
  slug,
  kind,
  targetAmount,
  deadline,
  waiting,
}: {
  slug: string;
  kind: CampaignKind;
  targetAmount: number;
  /** The current deadline as a WIB calendar date, or '' when there is none. */
  deadline: string;
  /** A change request already waits for a Verifier. */
  waiting: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState(formatRupiahInput(String(targetAmount)));
  const [date, setDate] = useState(deadline);
  const [errors, setErrors] = useState<{ target?: string; deadline?: string }>({});
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  if (waiting) {
    return (
      <p data-testid="change-request-waiting" className="text-sm text-text-secondary">
        Pengajuan perubahan target atau tenggat Anda sedang menunggu keputusan Verifier. Campaign tetap berjalan
        dengan nilai sekarang.
      </p>
    );
  }

  async function submit() {
    setMessage('');
    setSent(false);
    const newTarget = parseRupiahInput(target);
    const next: typeof errors = {};
    if (isNaN(newTarget) || newTarget <= 0) next.target = 'Target donasi harus lebih dari 0';
    // Only a changed deadline must still lie ahead; an unchanged one is the Campaign's own.
    const deadlineChanged = date !== deadline;
    const deadlineProblem = deadlineChanged ? deadlineError(kind, date) : undefined;
    if (deadlineProblem) next.deadline = deadlineProblem;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const changes: { targetAmount?: number; deadline?: string | null } = {};
    if (newTarget !== targetAmount) changes.targetAmount = newTarget;
    if (deadlineChanged) changes.deadline = date ? endOfWibDay(date).toISOString() : null;
    if (Object.keys(changes).length === 0) {
      setMessage('Ubah target atau tenggat terlebih dahulu.');
      return;
    }

    setPending(true);
    const refused = await requestCampaignChange(slug, changes);
    setPending(false);
    if (refused) {
      setMessage(refused);
      return;
    }
    setSent(true);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-secondary">
        Perubahan target atau tenggat diperiksa Verifier. Selama menunggu, Campaign tetap Active dan menerima donasi
        dengan nilai sekarang.
      </p>
      <Input
        id="change-target"
        label="Target Donasi baru"
        value={target}
        onChange={(value) => setTarget(formatRupiahInput(value))}
        error={errors.target}
        prefix="Rp"
      />
      <CampaignDeadlineField kind={kind} value={date} error={errors.deadline} onChange={setDate} />
      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
      {sent && <p className="text-sm text-[#2E7D32]">Pengajuan perubahan terkirim. Menunggu keputusan Verifier.</p>}
      <Button variant="primary" size="full" onClick={submit} isLoading={pending} disabled={pending}>
        Ajukan Perubahan
      </Button>
    </div>
  );
}
