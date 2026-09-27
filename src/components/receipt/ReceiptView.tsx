'use client';

import { useState } from 'react';
import { formatRupiah } from '@/lib/utils/currency';
import { formatIndonesianDate } from '@/lib/utils/date';

export type ReceiptViewProps = {
  token: string;
  campaignTitle: string;
  collectingEntityName: string;
  amount: number;
  paidAt: string;
  donorName: string | null;
};

type ResendState = { status: 'idle' | 'sending' | 'sent' | 'error'; message?: string };

/**
 * The Donor's proof of a Donation (CONTEXT.md, Receipt): reachable from the
 * email and the dashboard alike, printable, and resendable without an
 * account -- the token in the URL is the only thing that gates it.
 */
export function ReceiptView(props: ReceiptViewProps) {
  const [resend, setResend] = useState<ResendState>({ status: 'idle' });

  async function handleResend() {
    setResend({ status: 'sending' });
    try {
      const response = await fetch(`/api/receipts/${props.token}/resend`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        setResend({ status: 'error', message: data.error || 'Gagal mengirim ulang bukti donasi' });
        return;
      }
      setResend({ status: 'sent', message: 'Bukti donasi terkirim ulang ke email Anda.' });
    } catch {
      setResend({ status: 'error', message: 'Gagal mengirim ulang bukti donasi' });
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] py-10 px-4 print:bg-white print:py-0">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-sm p-6 print:shadow-none print:rounded-none">
        <h1 className="text-lg font-semibold text-[#212121]">Bukti Donasi</h1>

        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-[#757575]">Campaign</dt>
            <dd className="text-[#212121] font-medium">{props.campaignTitle}</dd>
          </div>
          <div>
            <dt className="text-[#757575]">Donor</dt>
            <dd className="text-[#212121] font-medium">{props.donorName || 'Donor'}</dd>
          </div>
          <div>
            <dt className="text-[#757575]">Jumlah</dt>
            <dd className="text-[#0073E6] font-bold">{formatRupiah(props.amount)}</dd>
          </div>
          <div>
            <dt className="text-[#757575]">Tanggal</dt>
            <dd className="text-[#212121]">{formatIndonesianDate(new Date(props.paidAt))}</dd>
          </div>
          <div>
            <dt className="text-[#757575]">Diterima oleh</dt>
            <dd className="text-[#212121] font-medium">{props.collectingEntityName}</dd>
          </div>
        </dl>

        <div className="mt-6 flex gap-2 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 bg-[#0073E6] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#005BB5] transition-colors"
          >
            Cetak
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={resend.status === 'sending'}
            className="flex-1 border border-[#0073E6] text-[#0073E6] text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#E3F2FD] transition-colors disabled:opacity-50"
          >
            Kirim ulang ke email
          </button>
        </div>

        {resend.message && (
          <p
            className={`mt-3 text-sm print:hidden ${resend.status === 'error' ? 'text-[#D50000]' : 'text-[#2E7D32]'}`}
          >
            {resend.message}
          </p>
        )}
      </div>
    </div>
  );
}
