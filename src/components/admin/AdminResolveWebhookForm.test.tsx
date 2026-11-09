import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { AdminResolveWebhookForm } from './AdminResolveWebhookForm';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refresh.mockClear();
});

describe('AdminResolveWebhookForm', () => {
  it('keeps the button disabled until a note is written', () => {
    render(<AdminResolveWebhookForm eventId="e1" />);
    const button = screen.getByRole('button', { name: 'Tandai selesai' });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Catatan penyelesaian'), { target: { value: '   ' } });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Catatan penyelesaian'), { target: { value: 'Refund penuh' } });
    expect(button).toBeEnabled();
  });

  it('posts the trimmed note to the event, then refreshes the page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ resolved: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminResolveWebhookForm eventId="e1" />);

    fireEvent.change(screen.getByLabelText('Catatan penyelesaian'), { target: { value: '  Refund penuh  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tandai selesai' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/webhook-events/e1/resolve',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ note: 'Refund penuh' }) }),
    );
  });

  it('shows the server refusal in its own words and does not refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Sudah ditandai selesai.' }), { status: 409 })),
    );
    render(<AdminResolveWebhookForm eventId="e1" />);

    fireEvent.change(screen.getByLabelText('Catatan penyelesaian'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tandai selesai' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sudah ditandai selesai.');
    expect(refresh).not.toHaveBeenCalled();
  });
});
