'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SandboxBadge } from '@/components/money/SandboxBadge';
import { formatRupiah } from '@/lib/utils/currency';
import { exceedsPayoutBalance } from '@/lib/payout-balance-rule';
import { PAYOUT_STATUS_LABEL } from '@/lib/payout-status-label';
import type { PayoutStatus } from '@/generated/prisma/client';

/**
 * A Trip Fundraiser's own money on one Volunteer Trip, and the form to ask
 * for some of it (ticket 83; CONTEXT.md, Payout, Trip Balance). Modelled on
 * CampaignPayoutPanel and wired to the existing route
 * (GET and POST /api/volunteer-trips/[slug]/payouts).
 *
 * - THE FIGURE TO WITHDRAW IS `withdrawable`, not the Trip Balance: the part
 *   of the balance still inside a Batch that has not completed can be
 *   refunded to a Volunteer, so it is not offered (ticket 49). The server
 *   judges every request again; this screen only avoids collecting one it
 *   will refuse, and shows the server's own words when it refuses anyway.
 * - NEVER AN ACCOUNT NUMBER. The picker lists bank code and account name
 *   only, and the form has no field that could take a number (ADR 0012).
 * - AN EMPTY PICKER IS NOT A DEAD END (ticket 17): both sentences link to
 *   /akun/rekening, and which one shows tells "never added one" from "added
 *   one that is pending or was rejected".
 */

interface PayoutRow {
  id: string;
  amount: number;
  description: string;
  status: PayoutStatus;
  createdAt: string;
}

interface BankAccountOption {
  id: string;
  bankCode: string;
  accountName: string;
}

interface TripPayoutRead {
  escrowHold: number;
  tripBalance: number;
  withdrawable: number;
  sandbox?: boolean;
  payouts: PayoutRow[];
  bankAccounts: BankAccountOption[];
  hasUnverifiedBankAccount: boolean;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' });
}

export function TripPayoutPanel({ slug }: { slug: string }) {
  const router = useRouter();
  const [data, setData] = useState<TripPayoutRead | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/volunteer-trips/${slug}/payouts`);
      if (!res.ok) throw new Error();
      setData(await res.json());
      setLoadError(null);
    } catch {
      setLoadError('Gagal memuat data pencairan.');
    }
  }, [slug]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
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
  // The one named rule the money layer is written against, asked of the
  // withdrawable figure the server just sent.
  const overBalance = exceedsPayoutBalance(requested, data.withdrawable);
  const canRequest =
    data.withdrawable > 0 &&
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
      const res = await fetch(`/api/volunteer-trips/${slug}/payouts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccountId, amount: requested, description: description.trim() }),
      });
      if (!res.ok) {
        // The server's own words: a domain refusal (funds not yet from a
        // completed Batch, a balance spent elsewhere) is shown as given.
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
    <section aria-label="Pencairan Trip Fee" className="space-y-4">
      {data.sandbox && (
        <p role="note" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Simulasi (UJI).</strong> Saldo dan pencairan di sini memakai uang uji dari
          masa Beta. Tidak ada transfer nyata ke rekening mana pun.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-xs text-text-secondary">Belum bisa dicairkan</p>
          <p className="text-lg font-semibold text-text">{formatRupiah(data.escrowHold)}</p>
          <p className="mt-1 text-xs text-text-secondary">Masih dalam masa tunggu penyedia pembayaran.</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-xs text-text-secondary">
            Bisa dicairkan
            <SandboxBadge sandbox={data.sandbox === true} />
          </p>
          <p className="text-lg font-semibold text-text">{formatRupiah(data.withdrawable)}</p>
          <p className="mt-1 text-xs text-text-secondary">
            Hanya dana dari Batch yang sudah Selesai. Saldo Trip seluruhnya {formatRupiah(data.tripBalance)}.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-white p-4">
        <h3 className="text-sm font-semibold text-text">Ajukan pencairan</h3>

        {data.bankAccounts.length === 0 ? (
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
        ) : data.withdrawable === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">
            Saat ini belum ada dana dari Batch yang sudah Selesai, jadi belum ada yang bisa dicairkan.
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
                placeholder={formatRupiah(data.withdrawable)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2"
              />
            </label>
            {overBalance && (
              <p role="alert" className="text-xs text-danger">
                Jumlah melebihi saldo yang bisa dicairkan.
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
          <p className="mt-2 text-sm text-text-secondary">Belum ada pencairan untuk Trip ini.</p>
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
