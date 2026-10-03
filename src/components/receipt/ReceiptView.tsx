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
  /** The Donor's identity was removed (ticket 36): no name, no resend, no second request. */
  anonymised: boolean;
  /** The Donation belongs to an account: its owner anonymises from account settings, not by this link. */
  accountOwned: boolean;
};

type ResendState = { status: 'idle' | 'sending' | 'sent' | 'error'; message?: string };
type AnonymiseState = { status: 'idle' | 'confirming' | 'sending' | 'done' | 'error'; message?: string };

/**
 * The Donor's proof of a Donation (CONTEXT.md, Receipt): reachable from the
 * email and the dashboard alike, printable, and resendable without an
 * account -- the token in the URL is the only thing that gates it.
 */
export function ReceiptView(props: ReceiptViewProps) {
  const [resend, setResend] = useState<ResendState>({ status: 'idle' });
  const [anonymise, setAnonymise] = useState<AnonymiseState>({ status: 'idle' });
  const [email, setEmail] = useState('');
  const anonymised = props.anonymised || anonymise.status === 'done';

  async function handleAnonymise() {
    setAnonymise({ status: 'sending' });
    try {
      const response = await fetch(`/api/receipts/${props.token}/anonymise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) {
        setAnonymise({ status: 'error', message: data.error || 'Gagal menganonimkan identitas' });
        return;
      }
      setAnonymise({ status: 'done' });
    } catch {
      setAnonymise({ status: 'error', message: 'Gagal menganonimkan identitas' });
    }
  }

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
    <div className="min-h-screen bg-bg-secondary py-10 px-4 print:bg-white print:py-0">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-xs p-6 print:shadow-none print:rounded-none">
        <h1 className="text-lg font-semibold text-text">Bukti Donasi</h1>

        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-text-secondary">Campaign</dt>
            <dd className="text-text font-medium">{props.campaignTitle}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Donor</dt>
            <dd className="text-text font-medium">{anonymised ? 'Donor anonim' : props.donorName || 'Donor'}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Jumlah</dt>
            <dd className="text-[#0073E6] font-bold">{formatRupiah(props.amount)}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Tanggal</dt>
            <dd className="text-text">{formatIndonesianDate(new Date(props.paidAt))}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Diterima oleh</dt>
            <dd className="text-text font-medium">{props.collectingEntityName}</dd>
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
          {!anonymised && (
            <button
              type="button"
              onClick={handleResend}
              disabled={resend.status === 'sending'}
              className="flex-1 border border-[#0073E6] text-[#0073E6] text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#E3F2FD] transition-colors disabled:opacity-50"
            >
              Kirim ulang ke email
            </button>
          )}
        </div>

        {resend.message && (
          <p className={`mt-3 text-sm print:hidden ${resend.status === 'error' ? 'text-danger' : 'text-[#2E7D32]'}`}>
            {resend.message}
          </p>
        )}

        <div className="mt-6 border-t border-[#EEEEEE] pt-4 text-sm print:hidden">
          {anonymised ? (
            <p className="text-[#2E7D32]">
              Identitas Donor pada donasi ini sudah dianonimkan. Nominal dan bukti donasi tetap tersimpan.
            </p>
          ) : props.accountOwned ? (
            <p className="text-text-secondary">
              Ingin identitas Anda dihapus dari donasi ini? Masuk lalu buka{' '}
              <a href="/akun/pengaturan" className="text-[#0073E6] underline">
                Pengaturan akun
              </a>
              .
            </p>
          ) : anonymise.status === 'idle' ? (
            <button
              type="button"
              onClick={() => setAnonymise({ status: 'confirming' })}
              className="text-danger underline"
            >
              Hapus identitas saya
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-text">
                Nama, email, dan telepon Anda akan dihapus dari donasi ini saja (hanya donasi ini; donasi lain tidak
                berubah). Nominal dan catatan keuangan tetap. Tindakan ini tidak dapat dibatalkan, bukti donasi ini
                tidak dapat dikirim ulang, dan donasi ini tidak dapat di-refund lewat sistem.
              </p>
              <label className="block">
                <span className="block text-text mb-1">Email yang dipakai pada donasi ini</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full border border-[#BDBDBD] rounded-lg px-3 py-2"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAnonymise}
                  disabled={anonymise.status === 'sending' || email.trim() === ''}
                  className="flex-1 bg-danger text-white font-medium px-4 py-2.5 rounded-lg disabled:opacity-50"
                >
                  Ya, anonimkan
                </button>
                <button
                  type="button"
                  onClick={() => setAnonymise({ status: 'idle' })}
                  disabled={anonymise.status === 'sending'}
                  className="flex-1 border border-[#BDBDBD] text-text font-medium px-4 py-2.5 rounded-lg disabled:opacity-50"
                >
                  Batal
                </button>
              </div>
              {anonymise.message && <p className="text-danger">{anonymise.message}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
