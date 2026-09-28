'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatRupiah } from '@/lib/utils/currency';
// STATUS_LABEL below is the CAMPAIGN lifecycle's status names -- this panel
// shows a Campaign's status on a Payout screen, which is the one place both
// vocabularies are on screen at once. The Payout one is
// PAYOUT_STATUS_LABEL, under a name of its own for exactly that reason.
import { STATUS_LABEL } from '@/lib/campaign-status-label';
import { exceedsPayoutBalance } from '@/lib/payout-balance-rule';
import { PAYOUT_REQUESTABLE_STATUSES } from '@/lib/payout-requestable-statuses';
import { PAYOUT_STATUS_LABEL } from '@/lib/payout-status-label';
import type { CampaignLifecycleStatus } from '@/types/campaign';
import type { PayoutStatus } from '@/generated/prisma/client';

/**
 * A Fundraiser's own money on one Campaign, and the form to ask for some of
 * it (PRD FFI-07; CONTEXT.md, Payout, Escrow Hold, Campaign Balance).
 *
 * What this panel shows, and why each part is here:
 *
 * - ESCROW HOLD AND CAMPAIGN BALANCE, SEPARATELY, BOTH FROM THE LEDGER. One
 *   number for "what I raised" would be a lie in both directions: it would
 *   hide money still inside the hold, and it would count money already paid
 *   out. They are two accounts in the book (ESCROW_HOLD, CAMPAIGN_BALANCE)
 *   and the server sums each from the ledger
 *   (GET /api/user/campaigns/[slug]/payouts). The panel derives no figure of
 *   its own from any other: it renders those two, and every question it asks
 *   about them is asked of a rule the money layer also enforces.
 *
 * - THE HOLD IS COUNTED FROM THE PROVIDER'S SETTLEMENT ESTIMATE, not from
 *   when the Donor paid. That is true in the books already (escrowReleaseAt
 *   is settledAt + the frozen hold length, prd-compliance 19), and the reason
 *   the two figures are worth separating on screen: a Donor who paid
 *   yesterday may be three weeks from being withdrawable on a slow-settling
 *   provider, and that is the hold doing its job, not money lost.
 *
 * - STATUS VISIBLE THROUGHOUT. A request is a promise to a person who cannot
 *   see the operator's queue, so every Payout on the Campaign is listed with
 *   the state it is actually in, including the long "waiting for an Admin"
 *   one. Nothing here decides or moves a Payout along: approving and
 *   completing are Admin acts on the operator side, under the two-person
 *   rule (ADR 0006), and this panel has no control that could do either.
 *
 * - A DEMO CAMPAIGN IS SAID TO BY NAME. Its numbers are fixture data with no
 *   ledger behind them, so a zero balance would read as a shortfall and send
 *   the Fundraiser looking for money that was never there.
 *
 * - NO PROGRAM BALANCE, AND NO WAY TO REACH ONE. A Program's money is CSR
 *   money recorded off-gateway and is never withdrawable by anyone
 *   (CONTEXT.md, Program Balance; FFI-09): a Payout has no Program column at
 *   all. This panel is scoped to one Campaign's slug and its read is scoped
 *   to that Campaign's rows, so there is nothing here that could offer a
 *   Program's balance, and nothing that could spend one.
 *
 * The request is posted to the existing Campaign route
 * (POST /api/campaigns/[slug]/payouts), which is where the two-person rule
 * and every money check live, and the server is the holder of every one of
 * them. About MONEY this panel asks two questions, and asks the same named
 * rules the money layer is written against -- may a Payout be requested in
 * this Campaign's status (PAYOUT_REQUESTABLE_STATUSES), and is this amount
 * more than the Campaign Balance (exceedsPayoutBalance) -- so a Fundraiser is
 * told what the server would say before they submit rather than after. The
 * rest of what disables the button is a field being empty, which is a
 * question about the form, not about money.
 */

interface PayoutRow {
  id: string;
  amount: number;
  description: string;
  status: PayoutStatus;
  createdAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  /**
   * Ticket 22 (PRD FFI-07a; CONTEXT.md, Usage Report): null for a Payout that
   * is not yet COMPLETED, since the question does not apply to it yet.
   * 'missing' and 'disputed' both block the next Payout on this Campaign
   * (campaignBlockingUsageReport, @/lib/usage-reports.ts) and both leave the
   * form offered below; 'submitted' hides it.
   */
  usageReportStatus: 'missing' | 'submitted' | 'disputed' | null;
}

interface BankAccountOption {
  id: string;
  bankCode: string;
  accountName: string;
}

interface PayoutRead {
  isDemo: boolean;
  /** The Campaign's EFFECTIVE status, so Expired reads as Expired here too. */
  lifecycleStatus: CampaignLifecycleStatus;
  escrowHold: number;
  campaignBalance: number;
  payouts: PayoutRow[];
  bankAccounts: BankAccountOption[];
  /**
   * True only when `bankAccounts` is empty AND the Fundraiser has some other
   * Bank Account on file that a Verifier has not approved -- PENDING, or
   * REJECTED (ticket 16 decision 5 makes REJECTED permanent, so for that
   * account this is not a state that will ever clear). Ticket 17: the same
   * empty picker used to read as one sentence for two different people, and
   * only this bit lets the screen tell "never added one" from "added one,
   * still not verified" apart.
   */
  hasUnverifiedBankAccount: boolean;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface UsageReportLineItemInput {
  label: string;
  amount: string;
}

/**
 * The form for one COMPLETED Payout that still needs a Usage Report (ticket
 * 22; PRD FFI-07a): a narrative, at least one line item, a beneficiary count,
 * and at least one photo URL. Posts to
 * POST /api/campaigns/[slug]/payouts/[id]/usage-report, which is where every
 * rule about the report actually lives (@/lib/usage-reports.ts) -- this form
 * only collects the fields and shows the server's own refusal when it says
 * no, the same choice the Payout request form above makes.
 *
 * ONE LINE ITEM, TODAY. The server accepts several ("rincian per pos"); this
 * form offers exactly one because that is enough to satisfy the arithmetic
 * (its amount must equal the Payout's own) without asking a Fundraiser
 * reporting on a single expense to split it up. Nothing here stops the
 * amount being wrong -- the server is still the one that checks the sum --
 * only the field is pre-filled with the Payout's own amount so the ordinary
 * case (one Payout, one purpose) needs no arithmetic at all.
 */
function UsageReportForm({ slug, payout, onSubmitted }: { slug: string; payout: PayoutRow; onSubmitted: () => void }) {
  const [narrative, setNarrative] = useState('');
  const [lineItem, setLineItem] = useState<UsageReportLineItemInput>({ label: '', amount: String(payout.amount) });
  const [beneficiaryCount, setBeneficiaryCount] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const amount = Number(lineItem.amount);
  const beneficiaries = Number(beneficiaryCount);
  const canSubmit =
    narrative.trim() !== '' &&
    lineItem.label.trim() !== '' &&
    Number.isInteger(amount) &&
    amount > 0 &&
    Number.isInteger(beneficiaries) &&
    beneficiaries > 0 &&
    photoUrl.trim() !== '' &&
    !submitting;

  async function submit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch(`/api/campaigns/${slug}/payouts/${payout.id}/usage-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          narrative: narrative.trim(),
          lineItems: [{ label: lineItem.label.trim(), amount }],
          beneficiaryCount: beneficiaries,
          photos: [photoUrl.trim()],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal mengirim Usage Report.');
        return;
      }
      onSubmitted();
    } catch {
      setRefusal('Gagal mengirim Usage Report.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-gray-50 p-3">
      <label className="block text-sm text-text">
        Narasi pemakaian dana
        <textarea
          aria-label="Narasi pemakaian dana"
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2"
        />
      </label>

      <label className="block text-sm text-text">
        Nama pos
        <input
          aria-label="Nama pos"
          value={lineItem.label}
          onChange={(e) => setLineItem((prev) => ({ ...prev, label: e.target.value }))}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2"
        />
      </label>

      <label className="block text-sm text-text">
        Nominal pos (Rp)
        <input
          aria-label="Nominal pos (Rp)"
          inputMode="numeric"
          value={lineItem.amount}
          onChange={(e) => setLineItem((prev) => ({ ...prev, amount: e.target.value.replace(/\D/g, '') }))}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2"
        />
      </label>
      <p className="text-xs text-text-secondary">
        Total rincian harus sama persis dengan nominal Payout ({formatRupiah(payout.amount)}).
      </p>

      <label className="block text-sm text-text">
        Jumlah penerima manfaat
        <input
          aria-label="Jumlah penerima manfaat"
          inputMode="numeric"
          value={beneficiaryCount}
          onChange={(e) => setBeneficiaryCount(e.target.value.replace(/\D/g, ''))}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2"
        />
      </label>

      <label className="block text-sm text-text">
        URL foto bukti
        <input
          aria-label="URL foto bukti"
          value={photoUrl}
          onChange={(e) => setPhotoUrl(e.target.value)}
          placeholder="https://..."
          className="mt-1 w-full rounded-lg border border-border px-3 py-2"
        />
      </label>
      <p className="text-xs text-text-secondary">Minimal satu foto bukti wajib dilampirkan.</p>

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Kirim
      </button>

      {refusal && (
        <p role="alert" className="text-sm text-danger">
          {refusal}
        </p>
      )}
    </div>
  );
}

export function CampaignPayoutPanel({ slug }: { slug: string }) {
  const router = useRouter();
  const [data, setData] = useState<PayoutRead | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Which COMPLETED Payout's Usage Report form is open, at most one at a
  // time -- there is no reason to fill in two reports side by side, and a
  // single id keeps the state as simple as the form itself.
  const [openUsageReportFor, setOpenUsageReportFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/user/campaigns/${slug}/payouts`);
      if (!res.ok) throw new Error();
      setData(await res.json());
      setLoadError(null);
    } catch {
      setLoadError('Gagal memuat data pencairan.');
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {loadError}
      </p>
    );
  }

  if (!data) {
    return <p className="text-sm text-text-secondary">Memuat data pencairan...</p>;
  }

  const requested = Number(amount.replace(/\D/g, ''));
  // The same named rule the money layer enforces
  // (exceedsPayoutBalance, @/lib/payout-balance-rule.ts), asked of the
  // balance the server just sent -- not a comparison written here, which is
  // how a screen ends up warning about a different number than the one that
  // would be refused. This is a WARNING, and the button stays disabled while
  // it shows: the server is still the holder of the decision, and it re-reads
  // the balance under the Campaign row lock before it judges the request.
  const overBalance = exceedsPayoutBalance(requested, data.campaignBalance);
  // Whether a Payout may be ASKED FOR at all, asked of the one list the money
  // layer is written against (PAYOUT_REQUESTABLE_STATUSES). Not a second copy
  // of the statuses: a status the screen allows and the guard refuses is a
  // Fundraiser who filled in a form to be told no. The server still judges
  // every request again under the Campaign row lock, where a Suspension that
  // committed a moment ago is seen -- this only keeps the screen from
  // collecting one.
  const requestable = PAYOUT_REQUESTABLE_STATUSES.includes(data.lifecycleStatus);
  const canRequest =
    !data.isDemo &&
    requestable &&
    data.campaignBalance > 0 &&
    data.bankAccounts.length > 0 &&
    requested > 0 &&
    !overBalance &&
    description.trim() !== '' &&
    bankAccountId !== '';

  async function submit() {
    if (!canRequest || submitting) return;
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch(`/api/campaigns/${slug}/payouts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccountId, amount: requested, description: description.trim() }),
      });
      if (!res.ok) {
        // The server's own refusal, in its own words: a Payout can be turned
        // down for a reason this panel cannot see (a Suspension that landed
        // since the page loaded, a balance another Admin already spent), and
        // inventing a generic message here would hide which one it was.
        const body = await res.json().catch(() => ({}));
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal mengajukan pencairan.');
        return;
      }
      setAmount('');
      setDescription('');
      setBankAccountId('');
      await load();
      router.refresh();
    } catch {
      setRefusal('Gagal mengajukan pencairan.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label="Pencairan dana" className="space-y-4">
      {data.isDemo && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Ini Campaign contoh. Angkanya bukan uang nyata, jadi tidak ada yang bisa dicairkan.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-xs text-text-secondary">Belum bisa dicairkan</p>
          <p className="text-lg font-semibold text-text">{formatRupiah(data.escrowHold)}</p>
          <p className="mt-1 text-xs text-text-secondary">
            Masih dalam masa tunggu, dihitung sejak perkiraan settlement penyedia.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-xs text-text-secondary">Bisa dicairkan</p>
          <p className="text-lg font-semibold text-text">{formatRupiah(data.campaignBalance)}</p>
          <p className="mt-1 text-xs text-text-secondary">Campaign Balance, dihitung dari buku besar.</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-white p-4">
        <h3 className="text-sm font-semibold text-text">Ajukan pencairan</h3>

        {data.isDemo ? null : !requestable ? (
          // The status is the reason, said by name: a Fundraiser whose
          // Campaign is Suspended is not being refused for something they did
          // wrong, and a form that is only greyed out would leave them
          // guessing which of their own actions to undo.
          <p className="mt-2 text-sm text-text-secondary">
            Campaign ini berstatus {STATUS_LABEL[data.lifecycleStatus]}, jadi pencairan tidak bisa diajukan.
          </p>
        ) : data.bankAccounts.length === 0 ? (
          // Ticket 17: no dead end either way -- both sentences below link to
          // the one place a Fundraiser can act, /akun/rekening, and which
          // sentence is shown is the one bit (hasUnverifiedBankAccount) that
          // tells apart someone who has never added an account from someone
          // whose account is still PENDING or was REJECTED.
          <p className="mt-2 text-sm text-text-secondary">
            {data.hasUnverifiedBankAccount ? (
              <>
                Anda sudah pernah mengajukan rekening bank, tapi belum ada yang terverifikasi.{' '}
                <Link href="/akun/rekening" className="font-medium text-primary underline">
                  Lihat status rekening
                </Link>
                .
              </>
            ) : (
              <>
                Payout hanya bisa dikirim ke rekening bank yang sudah terverifikasi, dan belum ada rekening
                terverifikasi atas nama Anda.{' '}
                <Link href="/akun/rekening" className="font-medium text-primary underline">
                  Tambah rekening bank
                </Link>
                .
              </>
            )}
          </p>
        ) : data.campaignBalance === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">
            Campaign Balance Anda masih kosong, jadi belum ada yang bisa dicairkan.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <label className="block text-sm text-text">
              Rekening tujuan
              <select
                aria-label="Rekening tujuan"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2"
              >
                <option value="">Pilih rekening</option>
                {data.bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bankCode} - {account.accountName}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-text">
              Jumlah pencairan
              <input
                aria-label="Jumlah pencairan"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={formatRupiah(data.campaignBalance)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2"
              />
            </label>
            {overBalance && (
              <p role="alert" className="text-xs text-danger">
                Jumlah melebihi Campaign Balance yang tersedia.
              </p>
            )}

            <label className="block text-sm text-text">
              Keterangan
              <textarea
                aria-label="Keterangan"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2"
              />
            </label>

            <button
              type="button"
              onClick={submit}
              disabled={!canRequest || submitting}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Ajukan pencairan
            </button>
          </div>
        )}

        {refusal && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {refusal}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-white p-4">
        <h3 className="text-sm font-semibold text-text">Riwayat pencairan</h3>
        {data.payouts.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">Belum ada pencairan untuk campaign ini.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {data.payouts.map((payout) => (
              <li key={payout.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-text">{formatRupiah(payout.amount)}</p>
                  <p className="text-xs text-text-secondary">{PAYOUT_STATUS_LABEL[payout.status]}</p>
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  {payout.description} - diajukan {formatDate(payout.createdAt)}
                </p>

                {payout.usageReportStatus === 'submitted' && (
                  <p className="mt-2 text-xs text-text-secondary">Usage Report sudah dikirim untuk pencairan ini.</p>
                )}
                {payout.usageReportStatus === 'disputed' && (
                  <p role="alert" className="mt-2 text-xs text-danger">
                    Usage Report untuk pencairan ini ditandai dipertanyakan Admin.
                  </p>
                )}
                {payout.usageReportStatus === 'missing' &&
                  (openUsageReportFor === payout.id ? (
                    <UsageReportForm
                      slug={slug}
                      payout={payout}
                      onSubmitted={() => {
                        setOpenUsageReportFor(null);
                        load();
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenUsageReportFor(payout.id)}
                      className="mt-2 text-xs font-medium text-primary underline"
                    >
                      Kirim Usage Report
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
