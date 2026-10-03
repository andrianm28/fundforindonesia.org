'use client';

import { useState } from 'react';

type State =
  | { status: 'idle' }
  | { status: 'confirming' }
  | { status: 'sending' }
  | { status: 'done'; message: string }
  | { status: 'error'; message: string };

/**
 * Account settings' half of Donor anonymisation (PRD FFI-16; ticket 36). The
 * Guest Donor's half is the link on the Receipt page. It is irreversible, so
 * it says what it costs and asks once before sending anything.
 */
export function AnonymiseDonationsSection() {
  const [state, setState] = useState<State>({ status: 'idle' });

  async function confirm() {
    setState({ status: 'sending' });
    try {
      const response = await fetch('/api/user/anonymise-donations', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        setState({ status: 'error', message: data.error || 'Gagal menganonimkan identitas' });
        return;
      }
      setState({
        status: 'done',
        message:
          data.anonymisedCount > 0
            ? `Identitas Anda sudah dihapus dari ${data.anonymisedCount} donasi.`
            : 'Tidak ada donasi yang perlu dianonimkan.',
      });
    } catch {
      setState({ status: 'error', message: 'Gagal menganonimkan identitas' });
    }
  }

  const open = state.status === 'confirming' || state.status === 'sending' || state.status === 'error';

  return (
    <div className="bg-white rounded-xl shadow-xs p-4 space-y-3">
      <h2 className="text-text font-semibold text-sm">Privasi donasi</h2>
      {state.status === 'done' ? (
        <p className="text-[#2E7D32] text-sm">{state.message}</p>
      ) : !open ? (
        <>
          <p className="text-text-secondary text-sm">
            Hapus nama dan tautan akun Anda dari semua donasi yang pernah Anda berikan.
          </p>
          <button
            type="button"
            onClick={() => setState({ status: 'confirming' })}
            className="text-danger text-sm underline"
          >
            Hapus identitas dari donasi saya
          </button>
        </>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-text">
            Donasi Anda dilepas dari akun ini dan tampil sebagai anonim bagi publik dan Fundraiser. Nominal dan catatan
            keuangan tetap tersimpan. Tindakan ini tidak dapat dibatalkan, donasi yang sudah dianonimkan tidak dapat
            di-refund lewat sistem, dan Anda tidak lagi melihatnya di riwayat. Akun Anda tidak dihapus. Bila ada Refund
            yang belum selesai, permintaan ditunda sampai Refund itu selesai.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={state.status === 'sending'}
              className="flex-1 bg-danger text-white font-medium px-4 py-2.5 rounded-lg disabled:opacity-50"
            >
              Ya, anonimkan
            </button>
            <button
              type="button"
              onClick={() => setState({ status: 'idle' })}
              disabled={state.status === 'sending'}
              className="flex-1 border border-[#BDBDBD] text-text font-medium px-4 py-2.5 rounded-lg disabled:opacity-50"
            >
              Batal
            </button>
          </div>
          {state.status === 'error' && <p className="text-danger">{state.message}</p>}
        </div>
      )}
    </div>
  );
}
