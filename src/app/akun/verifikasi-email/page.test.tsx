import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The page the confirmation link opens (prd-compliance 23). Opening it spends
 * nothing: the token is only sent when the person presses the button, so a mail
 * scanner that fetches the link cannot confirm an address on their behalf.
 */

const params = vi.hoisted(() => ({ token: 'tok-123' as string | null }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'token' ? params.token : null) }),
}));

import VerifikasiEmailPage from './page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  params.token = 'tok-123';
});

describe('Verifikasi Email page', () => {
  it('sends nothing until the button is pressed, then posts the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ verified: true, claimed: 2 }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<VerifikasiEmailPage />);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /konfirmasi email/i }));

    await waitFor(() => expect(screen.getByText(/email berhasil dikonfirmasi/i)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/user/email-verification/confirm',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'tok-123' }) }),
    );
    expect(screen.getByText(/2 donasi/)).toBeTruthy();
  });

  it('says the link is not valid when the server refuses it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'x' }) }));

    render(<VerifikasiEmailPage />);
    fireEvent.click(screen.getByRole('button', { name: /konfirmasi email/i }));

    await waitFor(() => expect(screen.getByText(/tidak valid atau sudah kedaluwarsa/i)).toBeTruthy());
  });

  it('offers no button when the link carries no token', () => {
    params.token = null;

    render(<VerifikasiEmailPage />);

    expect(screen.queryByRole('button', { name: /konfirmasi email/i })).toBeNull();
    expect(screen.getByText(/tautan tidak lengkap/i)).toBeTruthy();
  });
});
