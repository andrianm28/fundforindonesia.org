import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { CampaignFlagForm } from './CampaignFlagForm';

const mockFetch = vi.fn();

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(body) } as Response);
}

function refused(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  cleanup();
  mockFetch.mockReset();
  mockRefresh.mockReset();
  vi.unstubAllGlobals();
});

/**
 * rilis-1-benda 66: the Verifier's way to raise a Flag from the moderation
 * screen of a Campaign (flagCampaign, src/lib/campaign-lifecycle.ts). The
 * server holds every rule about who may flag and from which status; this
 * form only asks for the reason and shows the server's own refusal.
 */
describe('CampaignFlagForm', () => {
  it("asks for a reason and posts it to the Campaign's flags route", async () => {
    mockFetch.mockImplementation(() => ok({ flag: { id: 'flag-1' } }));

    render(<CampaignFlagForm campaignSlug="sumur-desa" />);

    fireEvent.change(screen.getByLabelText(/alasan flag/i), {
      target: { value: 'Foto sampul dipakai ulang dari Campaign lain.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /pasang flag/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/campaigns/sumur-desa/flags');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ reason: 'Foto sampul dipakai ulang dari Campaign lain.' });
  });

  it("shows the server's refusal in its own words and keeps what was typed", async () => {
    const refusal =
      'Anda tidak dapat bertindak sebagai Verifier atas Campaign milik Anda sendiri. Tindakan ini harus dilakukan Verifier lain.';
    mockFetch.mockImplementation(() => refused(403, { error: refusal, code: 'OWN_CAMPAIGN_CONFLICT' }));

    render(<CampaignFlagForm campaignSlug="sumur-desa" />);
    fireEvent.change(screen.getByLabelText(/alasan flag/i), { target: { value: 'Mencurigakan.' } });
    fireEvent.click(screen.getByRole('button', { name: /pasang flag/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(refusal);
    expect(screen.getByLabelText(/alasan flag/i)).toHaveValue('Mencurigakan.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('confirms the Flag, empties the form for the next one and refreshes the page data', async () => {
    mockFetch.mockImplementation(() => ok({ flag: { id: 'flag-1' } }));

    render(<CampaignFlagForm campaignSlug="sumur-desa" />);
    fireEvent.change(screen.getByLabelText(/alasan flag/i), { target: { value: 'Mencurigakan.' } });
    fireEvent.click(screen.getByRole('button', { name: /pasang flag/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/flag terpasang/i);
    expect(screen.getByLabelText(/alasan flag/i)).toHaveValue('');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('offers no Flag without a reason, and not twice while one is on its way', async () => {
    let answer: (response: Response) => void = () => {};
    mockFetch.mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));

    render(<CampaignFlagForm campaignSlug="sumur-desa" />);
    const button = screen.getByRole('button', { name: /pasang flag/i });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/alasan flag/i), { target: { value: '   ' } });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/alasan flag/i), { target: { value: 'Mencurigakan.' } });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    answer({ ok: true, status: 201, json: () => Promise.resolve({}) } as Response);
    await waitFor(() => expect(screen.getByRole('status')).toBeDefined());
  });

  it('falls back to a plain sentence when the server answers without one', async () => {
    mockFetch.mockImplementation(() => refused(500, {}));

    render(<CampaignFlagForm campaignSlug="sumur-desa" />);
    fireEvent.change(screen.getByLabelText(/alasan flag/i), { target: { value: 'Mencurigakan.' } });
    fireEvent.click(screen.getByRole('button', { name: /pasang flag/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memasang Flag.');
  });

  it('says so, rather than failing silently, when the request itself fails', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));

    render(<CampaignFlagForm campaignSlug="sumur-desa" />);
    fireEvent.change(screen.getByLabelText(/alasan flag/i), { target: { value: 'Mencurigakan.' } });
    fireEvent.click(screen.getByRole('button', { name: /pasang flag/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memasang Flag.');
    expect(screen.getByRole('button', { name: /pasang flag/i })).not.toBeDisabled();
  });
});
