import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { AdminManualContributionCreateForm } from './AdminManualContributionCreateForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * One Admin records a Manual Contribution (ticket 26; CONTEXT.md, Manual
 * Contribution; PRD FFI-07c). The server is the only holder of every rule
 * this form asks about -- amount, proof, and the Demo/own-Campaign refusals
 * -- so this form only asks for the fields recordManualContribution needs
 * and shows the server's own refusal, in its own words.
 */
describe('AdminManualContributionCreateForm', () => {
  it('disables the button until amount and proof are filled in', () => {
    render(<AdminManualContributionCreateForm target={{ type: 'campaign', id: 'campaign-1' }} />);

    expect(screen.getByRole('button', { name: /catat kontribusi/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/jumlah/i), { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText(/bukti transfer/i), { target: { value: 'bukti.pdf' } });
    expect(screen.getByRole('button', { name: /catat kontribusi/i })).not.toBeDisabled();
  });

  it('posts exactly the campaignId body recordManualContribution expects', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contribution: { id: 'mc-1' } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminManualContributionCreateForm target={{ type: 'campaign', id: 'campaign-1' }} />);

    fireEvent.change(screen.getByLabelText(/jumlah/i), { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText(/bukti transfer/i), { target: { value: 'bukti.pdf' } });
    fireEvent.change(screen.getByLabelText(/catatan/i), { target: { value: 'transfer tunai' } });
    fireEvent.click(screen.getByRole('button', { name: /catat kontribusi/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/manual-contributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: 'campaign-1',
          amount: 250_000,
          proofReference: 'bukti.pdf',
          note: 'transfer tunai',
        }),
      }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/manual-contributions/mc-1'));
  });

  it('posts programId instead of campaignId for a Program target', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contribution: { id: 'mc-2' } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminManualContributionCreateForm target={{ type: 'program', id: 'program-1' }} />);

    fireEvent.change(screen.getByLabelText(/jumlah/i), { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText(/bukti transfer/i), { target: { value: 'bukti.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: /catat kontribusi/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/manual-contributions',
        expect.objectContaining({
          body: JSON.stringify({
            programId: 'program-1',
            amount: 100_000,
            proofReference: 'bukti.pdf',
            note: undefined,
          }),
        }),
      ),
    );
  });

  it('shows the server refusal in its own words', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'Bukti transfer wajib diisi.' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminManualContributionCreateForm target={{ type: 'campaign', id: 'campaign-1' }} />);

    fireEvent.change(screen.getByLabelText(/jumlah/i), { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText(/bukti transfer/i), { target: { value: 'bukti.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: /catat kontribusi/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Bukti transfer wajib diisi.');
    expect(mockPush).not.toHaveBeenCalled();
  });
});
