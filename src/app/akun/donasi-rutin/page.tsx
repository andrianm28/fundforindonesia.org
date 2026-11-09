'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { formatRupiah } from '@/lib/utils/currency';
import { MIN_DONATION_AMOUNT } from '@/lib/donations';
import { PERIOD_LABEL, type RecurringPeriod } from '@/lib/recurring-donations/schedule';

/**
 * Donasi rutin (PKS pasal 4.7). Nothing here charges anything: tiap siklus kami
 * menerbitkan satu tagihan (tautan bayar) lewat email dan kotak masuk, dan
 * donatur membayar atau tidak. Tanpa kartu tersimpan.
 */

interface CycleView {
  cycleIndex: number;
  dueDate: string;
  status: 'PAID' | 'PENDING' | 'OVERDUE';
  payUrl: string | null;
}
interface RecurringView {
  id: string;
  campaign: { id: string; slug: string; title: string };
  amount: number;
  period: RecurringPeriod;
  startDate: string;
  status: 'ACTIVE' | 'STOPPED';
  cycles: CycleView[];
}

const CYCLE_LABEL: Record<CycleView['status'], string> = {
  PAID: 'Lunas',
  PENDING: 'Menunggu pembayaran',
  OVERDUE: 'Lewat tempo',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' });
}

function todayJakarta(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

function DonasiRutinContent() {
  const params = useSearchParams();
  const [items, setItems] = useState<RecurringView[] | null>(null);
  const [error, setError] = useState('');
  // The Campaign the Donor came from (link on its page). The id stays hidden:
  // the Donor sees the title, and a Campaign that cannot take recurring
  // donations leaves this null.
  const wantedCampaign = params.get('campaign');
  const [campaign, setCampaign] = useState<{ id: string; title: string } | null>(null);
  const [campaignChecked, setCampaignChecked] = useState(!wantedCampaign);
  const [amount, setAmount] = useState('50000');
  const [period, setPeriod] = useState<RecurringPeriod>('MONTHLY');
  const [startDate, setStartDate] = useState(todayJakarta());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const query = wantedCampaign ? `?campaign=${encodeURIComponent(wantedCampaign)}` : '';
      const res = await fetch(`/api/donasi-rutin${query}`);
      if (!res.ok) throw new Error();
      const body = await res.json();
      setItems(body.recurringDonations);
      setCampaign(body.campaign ?? null);
    } catch {
      setError('Gagal memuat donasi rutin. Coba lagi.');
      setItems([]);
    } finally {
      setCampaignChecked(true);
    }
  }, [wantedCampaign]);

  useEffect(() => {
    // Loaded once on mount; setState happens in the response callbacks inside load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!campaign) return;
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/donasi-rutin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.id, amount: Number(amount), period, startDate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Gagal mendaftarkan donasi rutin.');
      } else {
        await load();
      }
    } catch {
      setError('Terjadi kesalahan jaringan, silakan coba lagi');
    } finally {
      setBusy(false);
    }
  }

  async function stop(id: string) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/donasi-rutin/${id}/berhenti`, { method: 'POST' });
      if (!res.ok) setError('Gagal menghentikan donasi rutin.');
      await load();
    } catch {
      setError('Terjadi kesalahan jaringan, silakan coba lagi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <h1 className="text-white text-lg font-semibold">Donasi Rutin</h1>
      </div>

      <div className="px-4 mt-4 space-y-3">
        <p className="rounded-xl bg-white p-4 shadow-xs text-sm text-text-secondary">
          Tiap siklus kami mengirim tagihan lewat email dan kotak masuk. Tidak ada dana yang dipotong otomatis:
          donasi tercatat bila Anda membayar lewat tautan tagihan.
        </p>

        {error && <p className="rounded-xl bg-[#FFEBEE] p-3 text-sm text-danger">{error}</p>}

        {campaignChecked && !campaign && (
          <p className="rounded-xl bg-white p-4 shadow-xs text-sm text-text-secondary">
            {wantedCampaign
              ? 'Campaign ini tidak dapat menerima donasi rutin saat ini. '
              : 'Untuk mendaftarkan donasi rutin, buka halaman Campaign yang Anda dukung lalu pilih "Donasi rutin". '}
            <Link href="/explore/all" className="text-[#0073E6] font-medium hover:underline">Jelajahi Campaign</Link>
          </p>
        )}

        {campaign && (
        <form onSubmit={register} className="rounded-xl bg-white p-4 shadow-xs space-y-3">
          <h2 className="text-sm font-semibold text-text">Daftarkan donasi rutin</h2>
          <p className="text-sm text-text">
            Untuk Campaign: <span className="font-semibold">{campaign.title}</span>
          </p>
          <label className="block text-xs text-text-secondary">
            Nominal per siklus (Rp)
            <input
              required
              type="number"
              min={MIN_DONATION_AMOUNT}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm text-text"
            />
          </label>
          <label className="block text-xs text-text-secondary">
            Periode
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as RecurringPeriod)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm text-text"
            >
              {(Object.keys(PERIOD_LABEL) as RecurringPeriod[]).map((p) => (
                <option key={p} value={p}>{PERIOD_LABEL[p]}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-text-secondary">
            Tagihan pertama pada
            <input
              required
              type="date"
              min={todayJakarta()}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm text-text"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-[#0073E6] text-white text-sm font-medium py-3 rounded-lg disabled:opacity-60"
          >
            Daftarkan
          </button>
        </form>
        )}

        {items === null && <div className="h-20 rounded-xl bg-border animate-pulse" />}
        {items?.length === 0 && !error && (
          <p className="text-center text-sm text-text-secondary">Belum ada donasi rutin.</p>
        )}
        {items?.map((item) => (
          <div key={item.id} className="rounded-xl bg-white p-4 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/campaign/${item.campaign.slug}`} className="text-sm font-semibold text-text hover:underline">
                  {item.campaign.title}
                </Link>
                <p className="text-[#0073E6] text-base font-bold mt-1">{formatRupiah(item.amount)}</p>
                <p className="text-xs text-text-secondary">
                  {PERIOD_LABEL[item.period]}, mulai {formatDate(item.startDate)}
                </p>
              </div>
              {item.status === 'ACTIVE' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => stop(item.id)}
                  className="shrink-0 text-danger text-xs font-medium hover:underline disabled:opacity-60"
                >
                  Hentikan
                </button>
              ) : (
                <span className="shrink-0 text-xs text-text-secondary">Dihentikan</span>
              )}
            </div>
            {item.cycles.length > 0 && (
              <ul className="mt-3 border-t border-border pt-2 space-y-1">
                {item.cycles.map((cycle) => (
                  <li key={cycle.cycleIndex} className="flex items-center justify-between text-xs">
                    <span className="text-text-secondary">{formatDate(cycle.dueDate)}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-text">{CYCLE_LABEL[cycle.status]}</span>
                      {cycle.payUrl && (
                        <a href={cycle.payUrl} className="text-[#0073E6] font-medium hover:underline">Bayar</a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DonasiRutinPage() {
  return (
    <Suspense fallback={null}>
      <DonasiRutinContent />
    </Suspense>
  );
}
