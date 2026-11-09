'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  calculateZakatMaal,
  calculateZakatPenghasilan,
  ZAKAT_INPUT_MAX,
  ZAKAT_INPUT_MAX_MESSAGE,
  ZAKAT_RATE_PERCENT,
  type ZakatResult,
} from '@/lib/zakat-calculator';
import { MAX_DONATION_AMOUNT, MIN_DONATION_AMOUNT } from '@/lib/donations';
import { formatRupiah } from '@/lib/utils/currency';

/**
 * The zakat calculator and the start of the checkout (PKS pemenuhan 19, ADR
 * 0028). It only helps with the sum: the payer may always type their own
 * amount, and the payment itself is the ordinary donation page of the zakat
 * Campaign (`/campaign/<slug>/donate?jumlah=`), so no money path is added here.
 */

type Tab = 'penghasilan' | 'maal';

function rawRupiah(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) return Number(trimmed.replace(/\./g, ''));
  return null;
}

/**
 * "10.000.000" or "10000000" -> number; empty -> 0; anything else (a comma, a
 * fraction, letters) or more than the calculator's ceiling -> null.
 */
function parseRupiah(text: string): number | null {
  const n = rawRupiah(text);
  return n === null || !Number.isSafeInteger(n) || n > ZAKAT_INPUT_MAX ? null : n;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const invalid = parseRupiah(value) === null;
  const raw = rawRupiah(value);
  const tooLarge = invalid && raw !== null;
  return (
    <label className="block text-sm text-text">
      {label}
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={invalid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border px-3 py-2"
      />
      {invalid && (
        <span className="mt-1 block text-xs text-danger">
          {tooLarge ? `Nilai ${ZAKAT_INPUT_MAX_MESSAGE}.` : 'Isi dengan angka rupiah bulat, tanpa koma.'}
        </span>
      )}
    </label>
  );
}

export function ZakatCalculator({
  nisabAmount,
  campaignSlug,
  recipientName,
}: {
  nisabAmount: number;
  campaignSlug: string | null;
  recipientName: string;
}) {
  const [tab, setTab] = useState<Tab>('penghasilan');
  const [income, setIncome] = useState('');
  const [otherIncome, setOtherIncome] = useState('');
  const [savings, setSavings] = useState('');
  const [gold, setGold] = useState('');
  const [trade, setTrade] = useState('');
  const [debts, setDebts] = useState('');
  const [manual, setManual] = useState('');
  // Zakat maal is owed only on wealth held a full year (haul); the calculator cannot know that.
  const [haul, setHaul] = useState(false);

  let result: ZakatResult | null = null;
  if (tab === 'penghasilan') {
    const a = parseRupiah(income);
    const b = parseRupiah(otherIncome);
    if (a !== null && b !== null && a + b > 0) {
      result = calculateZakatPenghasilan({ nisab: nisabAmount, monthlyIncome: a, otherMonthlyIncome: b });
    }
  } else {
    const parts = [parseRupiah(savings), parseRupiah(gold), parseRupiah(trade), parseRupiah(debts)];
    if (parts.every((p) => p !== null) && (parts[0] as number) + (parts[1] as number) + (parts[2] as number) > 0) {
      result = calculateZakatMaal({
        nisab: nisabAmount,
        savings: parts[0] as number,
        goldAndInvestments: parts[1] as number,
        tradeAssets: parts[2] as number,
        debtsDue: parts[3] as number,
      });
    }
  }

  // The amount to pay: what the payer typed, else what the calculator found.
  const manualValue = parseRupiah(manual);
  const typed = manual.trim() !== '';
  const counted = result?.obligatory && (tab === 'penghasilan' || haul);
  const amount = typed ? manualValue : counted && result ? result.amount : null;
  const payable =
    amount !== null && Number.isSafeInteger(amount) && amount >= MIN_DONATION_AMOUNT && amount <= MAX_DONATION_AMOUNT;

  return (
    <div className="space-y-6">
      {recipientName && (
        <p className="text-sm text-text-secondary">
          Zakat yang Anda bayar lewat halaman ini diterima oleh <strong>{recipientName}</strong>.
        </p>
      )}
      <div role="tablist" aria-label="Jenis zakat" className="flex gap-2">
        {(
          [
            ['penghasilan', 'Zakat penghasilan'],
            ['maal', 'Zakat maal'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === id ? 'bg-primary text-white' : 'border border-border text-text'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'penghasilan' ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Zakat penghasilan dihitung dari penghasilan sebulan, bila mencapai seperduabelas nisab tahunan (
            {formatRupiah(Math.ceil(nisabAmount / 12))}).
          </p>
          <Field label="Penghasilan per bulan (Rp)" value={income} onChange={setIncome} />
          <Field label="Penghasilan lain per bulan (Rp)" value={otherIncome} onChange={setOtherIncome} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Zakat maal dihitung dari harta bersih yang sudah dimiliki selama satu tahun (haul) dan mencapai nisab (
            {formatRupiah(nisabAmount)}).
          </p>
          <Field label="Tabungan (Rp)" value={savings} onChange={setSavings} />
          <Field label="Emas dan investasi (Rp)" value={gold} onChange={setGold} />
          <Field label="Aset usaha (Rp)" value={trade} onChange={setTrade} />
          <Field label="Utang jatuh tempo (Rp)" value={debts} onChange={setDebts} />
          <label className="flex items-start gap-2 text-sm text-text">
            <input type="checkbox" checked={haul} onChange={(e) => setHaul(e.target.checked)} className="mt-1" />
            <span>Saya sudah memiliki harta ini selama satu tahun penuh (haul).</span>
          </label>
        </div>
      )}

      <div data-testid="zakat-result" className="rounded-xl bg-bg-secondary p-4 text-sm text-text">
        {result === null ? (
          <p>Isi angka di atas untuk melihat perhitungan, atau langsung isi nominal sendiri di bawah.</p>
        ) : result.obligatory && tab === 'maal' && !haul ? (
          <p>
            Harta yang dihitung {formatRupiah(result.base)} mencapai nisab, tetapi zakat maal baru wajib bila harta itu sudah
            dimiliki setahun penuh (haul). Centang pernyataan haul di atas bila itu benar. Kalkulator ini hanya alat bantu
            hitung.
          </p>
        ) : result.obligatory ? (
          <p>
            Harta yang dihitung {formatRupiah(result.base)} mencapai nisab. Zakat {ZAKAT_RATE_PERCENT.toString().replace('.', ',')}%:{' '}
            <strong>{formatRupiah(result.amount)}</strong>.
          </p>
        ) : (
          <p>
            Harta yang dihitung {formatRupiah(result.base)} belum mencapai nisab ({formatRupiah(result.threshold)}), jadi
            belum ada kewajiban zakat. Anda tetap boleh berinfak lewat halaman donasi.
          </p>
        )}
      </div>

      <Field label="Nominal zakat yang ingin dibayar (Rp)" value={manual} onChange={setManual} />

      {campaignSlug === null ? (
        <p className="text-sm text-text-secondary">
          Saat ini {recipientName || 'lembaga penerima'} belum bisa menerima pembayaran zakat lewat situs ini. Silakan kembali
          lagi nanti.
        </p>
      ) : payable ? (
        <div className="space-y-2">
          <p className="text-sm text-text">
            Pembayaran zakat {formatRupiah(amount as number)} diterima oleh <strong>{recipientName}</strong>.
          </p>
          <Link
            href={`/campaign/${encodeURIComponent(campaignSlug)}/donate?jumlah=${amount}`}
            className="inline-block rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white"
          >
            Lanjut ke pembayaran
          </Link>
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          Nominal pembayaran minimal {formatRupiah(MIN_DONATION_AMOUNT)}. Isi nominal atau hitung dulu zakat Anda.
        </p>
      )}
    </div>
  );
}
