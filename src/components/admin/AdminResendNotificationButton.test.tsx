import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { AdminResendNotificationButton } from './AdminResendNotificationButton';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refresh.mockClear();
});

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

describe('AdminResendNotificationButton', () => {
  it('posts the resend for that row and says it was sent', async () => {
    respond(200, { outcome: 'SENT' });
    render(<AdminResendNotificationButton id="n1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Kirim ulang' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Terkirim.');
    expect(fetch).toHaveBeenCalledWith('/api/admin/failed-notifications/n1/resend', { method: 'POST' });
    expect(refresh).toHaveBeenCalled();
  });

  it('says plainly when the provider refused again, so nobody thinks it went out', async () => {
    respond(200, { outcome: 'FAILED' });
    render(<AdminResendNotificationButton id="n1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Kirim ulang' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('menolak lagi'));
  });

  it('shows the server refusal for a row that is already sent', async () => {
    respond(409, { error: 'Notifikasi ini sudah terkirim atau sedang dikirim oleh proses lain.' });
    render(<AdminResendNotificationButton id="n1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Kirim ulang' }));

    expect(await screen.findByRole('status')).toHaveTextContent('sudah terkirim');
    expect(refresh).not.toHaveBeenCalled();
  });
});
